package dev.fokuroru.reader.work

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import dev.fokuroru.reader.Events
import dev.fokuroru.reader.Prefs
import dev.fokuroru.reader.data.AutoDelete
import dev.fokuroru.reader.data.LatestItem
import dev.fokuroru.reader.data.ReadingItem
import dev.fokuroru.reader.data.ReadingSnapshot
import dev.fokuroru.reader.data.Store
import dev.fokuroru.reader.net.Api
import dev.fokuroru.reader.net.AuthExpiredException
import dev.fokuroru.reader.net.GatewayException
import dev.fokuroru.reader.widget.ReadingNowWidget
import java.io.File
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * The scheduled pass: send queued progress, refresh what the widget and shortcuts show, save the
 * chapters coming up, tell the user about new ones, and clear out what has been read.
 */
object ReadingSync {
    fun run(context: Context) {
        val prefs = Prefs(context)
        val store = Store.get(context)
        val api = Api(context)
        val previous = ReadingSnapshot.load(context)

        ProgressSync.flush(context)

        val snapshot = fetch(context, api, previous) ?: return
        ReadingSnapshot.save(context, snapshot)
        snapshot.items.forEach { cacheCover(context, api, it) }
        ReadingNowWidget.updateAll(context)

        if (prefs.notifyNew) notifyNew(context, previous, snapshot)

        val ahead = prefs.autoDownloadNext
        if (ahead > 0) {
            snapshot.items.take(3).forEach { item -> saveAhead(context, api, store, item.chapterId, ahead) }
        }

        ProgressSync.pull(context)
        if (prefs.deleteRead) {
            for (id in AutoDelete.plan(store.deletable(), prefs.keepLastRead)) store.delete(id)
        }
        Events.downloadsChanged()
    }

    /** A fresh list for a shortcut or widget tap, or null when the server can't be asked. */
    fun refreshSnapshot(context: Context): ReadingSnapshot? {
        val snapshot = fetch(context, Api(context), ReadingSnapshot.load(context)) ?: return null
        ReadingSnapshot.save(context, snapshot)
        ReadingNowWidget.updateAll(context)
        return snapshot
    }

    private fun fetch(context: Context, api: Api, previous: ReadingSnapshot): ReadingSnapshot? = try {
        val home = api.getObject("/api/v1/home/reading?limit=8")
        val continuing = home.getJSONArray("continueReading")
        val jump = home.getJSONArray("jumpBackIn")
        val items = buildList {
            for (i in 0 until continuing.length()) add(toItem(continuing.getJSONObject(i), true))
            for (i in 0 until jump.length()) add(toItem(jump.getJSONObject(i), false))
        }
        val recent = api.getArray("/api/v1/home/recently-added?limit=1")
        val latest = if (recent.length() > 0) {
            val r = recent.getJSONObject(0)
            LatestItem(
                r.getInt("seriesId"), r.getString("seriesTitle"),
                if (r.isNull("readChapterId")) null else r.getInt("readChapterId"),
                if (r.isNull("newestChapterLabel")) null else r.getString("newestChapterLabel"),
            )
        } else {
            null
        }
        ReadingSnapshot(System.currentTimeMillis(), items, latest)
    } catch (e: GatewayException) {
        Notifications.signInNeeded(context)
        null
    } catch (_: AuthExpiredException) {
        null
    } catch (_: IOException) {
        null
    }

    private fun toItem(o: org.json.JSONObject, inProgress: Boolean) = ReadingItem(
        seriesId = o.getInt("seriesId"),
        title = o.getString("seriesTitle"),
        coverUrl = if (o.isNull("coverUrl")) null else o.getString("coverUrl"),
        chapterId = o.getInt("chapterId"),
        label = o.optString("chapterLabel"),
        page = o.optInt("page"),
        pageCount = o.optInt("pageCount"),
        unread = o.optInt("unreadChapters"),
        inProgress = inProgress,
    )

    private fun cacheCover(context: Context, api: Api, item: ReadingItem) {
        val url = item.coverUrl ?: return
        val file = ReadingSnapshot.coverFile(context, item.seriesId)
        val stamp = File(file.parentFile, "${item.seriesId}.url")
        if (file.isFile && stamp.isFile && stamp.readText() == url) return
        try {
            api.download(url, file)
            stamp.writeText(url)
        } catch (_: IOException) {
        }
    }

    private fun notifyNew(context: Context, before: ReadingSnapshot, after: ReadingSnapshot) {
        if (before.items.isEmpty()) return
        val unreadBefore = before.items.associate { it.seriesId to it.unread }
        for (item in after.items) {
            val prev = unreadBefore[item.seriesId] ?: continue
            if (item.unread > prev) Notifications.newChapters(context, item.seriesId, item.title, item.unread, item.chapterId)
        }
    }

    private fun saveAhead(context: Context, api: Api, store: Store, from: Int, ahead: Int) {
        var id: Int? = from
        var left = ahead + 1
        while (id != null && left > 0) {
            if (!store.hasChapter(id)) DownloadWorker.enqueue(context, id)
            left--
            id = try {
                val manifest = api.getObject("/api/v1/reader/chapter/$id")
                if (manifest.isNull("nextChapterId")) null else manifest.getInt("nextChapterId")
            } catch (_: IOException) {
                null
            }
        }
    }

    fun scaledCover(file: File, maxWidth: Int): Bitmap? {
        if (!file.isFile) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(file.path, bounds)
        if (bounds.outWidth <= 0) return null
        var sample = 1
        while (bounds.outWidth / (sample * 2) >= maxWidth) sample *= 2
        return BitmapFactory.decodeFile(file.path, BitmapFactory.Options().apply { inSampleSize = sample })
    }
}

class SyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result = try {
        ReadingSync.run(applicationContext)
        Result.success()
    } catch (_: Exception) {
        Result.retry()
    }

    companion object {
        private const val PERIODIC = "sync-periodic"
        private const val NOW = "sync-now"
        private val connected = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedule(context: Context) {
            val hours = Prefs(context).syncHours
            val manager = WorkManager.getInstance(context)
            if (hours <= 0) {
                manager.cancelUniqueWork(PERIODIC)
                return
            }
            val request = PeriodicWorkRequestBuilder<SyncWorker>(hours.toLong(), TimeUnit.HOURS)
                .setConstraints(connected)
                .build()
            manager.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.UPDATE, request)
        }

        fun syncNow(context: Context) {
            val request = OneTimeWorkRequestBuilder<SyncWorker>().setConstraints(connected).build()
            WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.KEEP, request)
        }
    }
}
