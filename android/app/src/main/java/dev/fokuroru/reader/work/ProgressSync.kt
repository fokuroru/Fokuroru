package dev.fokuroru.reader.work

import android.content.Context
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.WorkManager
import dev.fokuroru.reader.Events
import dev.fokuroru.reader.data.Store
import dev.fokuroru.reader.net.Api
import dev.fokuroru.reader.net.AuthExpiredException
import dev.fokuroru.reader.net.HttpStatusException
import org.json.JSONObject
import java.io.IOException
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneOffset

object ProgressSync {
    private const val THREADS = 4

    /** Runs [work] for every item a few at a time, so a library of many series is not asked about one by one. Stops early once [work] returns false. */
    private fun <T> eachParallel(items: List<T>, work: (T) -> Boolean) {
        if (items.isEmpty()) return
        val pool = java.util.concurrent.Executors.newFixedThreadPool(minOf(THREADS, items.size))
        val stop = java.util.concurrent.atomic.AtomicBoolean(false)
        try {
            items.map { item -> pool.submit { if (!stop.get() && !work(item)) stop.set(true) } }.forEach { it.get() }
        } finally {
            pool.shutdown()
        }
    }

    /** Sends what was read offline. Returns true when nothing is left waiting. */
    fun flush(context: Context): Boolean {
        val store = Store.get(context)
        val api = Api(context)
        val merged = dev.fokuroru.reader.data.ProgressMerge.merge(store.queuedProgress())
        for (entry in merged) {
            val body = JSONObject()
                .put("pageIndex", entry.page)
                .put("seconds", entry.seconds)
                .put("final", entry.final)
            if (entry.completed) body.put("completed", true)
            try {
                api.putJson("/api/v1/reader/chapter/${entry.chapterId}/progress", body)
                store.removeQueued(entry.ids)
            } catch (e: HttpStatusException) {
                // A chapter the server no longer has will never accept this; keep the rest moving.
                if (e.status in 400..499) store.removeQueued(entry.ids) else return false
            } catch (e: AuthExpiredException) {
                return false
            } catch (e: IOException) {
                return false
            }
        }
        return true
    }

    /** Pulls read state for saved chapters, so reading done elsewhere is respected. */
    fun pull(context: Context) {
        val store = Store.get(context)
        val api = Api(context)
        val saved = store.all().filter { it.state == "done" }
        val pending = store.pendingChapterIds()
        eachParallel(saved.map { it.seriesId }.distinct()) { seriesId ->
            try {
                val rows = api.getArray("/api/v1/reader/series/$seriesId/progress")
                val known = HashSet<Int>()
                for (i in 0 until rows.length()) {
                    val row = rows.getJSONObject(i)
                    known += row.getInt("chapterId")
                    store.applyServerProgress(
                        row.getInt("chapterId"),
                        row.optInt("pageIndex"),
                        row.optBoolean("completed") && row.isNull("unreadAt"),
                        parseTime(row.optString("updatedAt")),
                    )
                }
                // Unsent reading was flushed first, so a chapter the server has nothing on is unread there.
                saved.filter { it.seriesId == seriesId && it.chapterId !in known && it.chapterId !in pending }
                    .forEach { store.resetProgress(it.chapterId) }
                true
            } catch (_: IOException) {
                false
            }
        }
    }

    /**
     * Drops chapters whose file is gone from the server, so the phone matches the library. Chapters still
     * waiting or failed go too: they can never download, and would keep a series listed with nothing to open.
     */
    fun prune(context: Context) {
        val store = Store.get(context)
        val api = Api(context)
        val known = store.all().filter { it.seriesId > 0 }
        val pending = store.pendingChapterIds()
        eachParallel(known.map { it.seriesId }.distinct()) { seriesId ->
            val onServer = try {
                val rows = api.getArray("/api/v1/chapter?seriesId=$seriesId")
                (0 until rows.length()).map { rows.getJSONObject(it) }.filter { it.optBoolean("hasFile") }.map { it.getInt("id") }.toSet()
            } catch (e: HttpStatusException) {
                // The series itself is gone; any other failure says nothing about the files.
                if (e.status == 404) emptySet() else return@eachParallel false
            } catch (_: IOException) {
                return@eachParallel false
            }
            known.filter { it.seriesId == seriesId && it.chapterId !in onServer && it.chapterId !in pending }.forEach {
                DownloadWorker.cancel(context, it.chapterId)
                store.delete(it.chapterId)
            }
            true
        }
    }

    /** Everything to do when the server answers: send what was read here, take what was read elsewhere, drop what was deleted. */
    fun syncSaved(context: Context) {
        if (!flush(context)) return
        prune(context)
        pull(context)
        Events.downloadsChanged()
    }

    fun parseTime(text: String): Long = try {
        if (text.isEmpty()) 0 else if (text.endsWith("Z") || text.contains('+')) Instant.parse(text).toEpochMilli()
        else LocalDateTime.parse(text).toInstant(ZoneOffset.UTC).toEpochMilli()
    } catch (_: Exception) {
        0
    }

    fun schedule(context: Context) {
        val request = OneTimeWorkRequestBuilder<FlushWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("flush-progress", ExistingWorkPolicy.REPLACE, request)
    }
}

class FlushWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val done = ProgressSync.flush(applicationContext)
        Events.downloadsChanged()
        return if (done) Result.success() else Result.retry()
    }
}
