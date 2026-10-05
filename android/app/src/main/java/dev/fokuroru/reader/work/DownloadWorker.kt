package dev.fokuroru.reader.work

import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import dev.fokuroru.reader.Events
import dev.fokuroru.reader.Prefs
import dev.fokuroru.reader.data.Profiles
import dev.fokuroru.reader.data.State
import dev.fokuroru.reader.data.Store
import dev.fokuroru.reader.net.Api
import dev.fokuroru.reader.net.AuthExpiredException
import java.io.IOException

/** Saves one chapter's pages and manifest to private storage. Resumable: pages already on disk are kept. */
class DownloadWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    private val store = Store.get(context)
    private val api = Api(context)

    override suspend fun getForegroundInfo(): ForegroundInfo = foreground("", 0, 0)

    private fun foreground(label: String, done: Int, total: Int): ForegroundInfo {
        val notification = Notifications.downloading(applicationContext, label.ifEmpty { "chapter" }, done, total)
        return if (Build.VERSION.SDK_INT >= 29) {
            ForegroundInfo(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification)
        }
    }

    override suspend fun doWork(): Result {
        val chapterId = inputData.getInt(CHAPTER_ID, -1)
        if (chapterId < 0) return Result.failure()
        // Chapter ids belong to one profile. Switching cancels these jobs and re-queues them on return.
        if (Profiles.activeId(applicationContext) != inputData.getLong(PROFILE_ID, 0L)) return Result.failure()

        try {
            runCatching { setForeground(foreground("", 0, 0)) }
            store.setState(chapterId, State.DOWNLOADING)
            Events.downloadsChanged()

            val manifestText = api.getText("/api/v1/reader/chapter/$chapterId")
            val manifest = org.json.JSONObject(manifestText)
            val pageCount = manifest.getInt("pageCount")
            val label = manifest.optString("label")
            val series = manifest.optString("seriesTitle")
            val title = if (series.isNotEmpty()) "$series $label" else label
            store.setManifest(chapterId, manifest.getInt("seriesId"), series, label, pageCount, manifestText)
            // Art for the saved-chapters grid; a missing cover is not worth failing a chapter over.
            dev.fokuroru.reader.data.Covers.ensure(applicationContext, api, manifest.getInt("seriesId"))
            Events.downloadsChanged()

            val version = manifest.optString("pageVersion")
            var bytes = store.get(chapterId)?.bytes ?: 0L
            for (page in 0 until pageCount) {
                if (isStopped) return Result.retry()
                val file = store.pageFile(chapterId, page)
                if (!file.isFile) {
                    val query = if (version.isNotEmpty()) "?v=" + java.net.URLEncoder.encode(version, "UTF-8") else ""
                    bytes += retrying { api.download("/api/v1/reader/chapter/$chapterId/page/$page$query", file) { isStopped } }
                }
                store.pageDone(chapterId, page + 1, bytes)
                if (page % 4 == 0 || page == pageCount - 1) {
                    setForeground(foreground(title, page + 1, pageCount))
                    Events.downloadsChanged()
                }
            }
            store.finish(chapterId)
            Events.downloadsChanged()
            return Result.success()
        } catch (e: AuthExpiredException) {
            if (e is dev.fokuroru.reader.net.GatewayException) Notifications.signInNeeded(applicationContext)
            store.fail(chapterId, "Signed out")
            Events.downloadsChanged()
            return Result.failure()
        } catch (e: IOException) {
            return if (runAttemptCount < MAX_ATTEMPTS) {
                Result.retry()
            } else {
                store.fail(chapterId, e.message)
                Events.downloadsChanged()
                Result.failure()
            }
        }
    }

    private suspend fun <T> retrying(block: () -> T): T {
        var last: IOException? = null
        repeat(3) {
            try {
                return block()
            } catch (e: AuthExpiredException) {
                throw e
            } catch (e: IOException) {
                last = e
                kotlinx.coroutines.delay(800L * (it + 1))
            }
        }
        throw last ?: IOException("Download failed")
    }

    companion object {
        const val CHAPTER_ID = "chapter_id"
        const val PROFILE_ID = "profile_id"
        private const val NOTIFICATION_ID = 4101
        private const val MAX_ATTEMPTS = 4

        fun enqueue(context: Context, chapterId: Int) {
            val prefs = Prefs(context)
            val store = Store.get(context)
            if (!store.queue(chapterId)) return
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(if (prefs.wifiOnly) NetworkType.UNMETERED else NetworkType.CONNECTED)
                .setRequiresCharging(prefs.chargingOnly)
                .build()
            val request = OneTimeWorkRequestBuilder<DownloadWorker>()
                .setConstraints(constraints)
                .setInputData(
                    Data.Builder().putInt(CHAPTER_ID, chapterId).putLong(PROFILE_ID, Profiles.activeId(context)).build(),
                )
                .addTag(TAG)
                .build()
            WorkManager.getInstance(context)
                .enqueueUniqueWork(workName(context, chapterId), ExistingWorkPolicy.KEEP, request)
            Events.downloadsChanged()
        }

        fun cancel(context: Context, chapterId: Int) {
            WorkManager.getInstance(context).cancelUniqueWork(workName(context, chapterId))
        }

        private fun workName(context: Context, chapterId: Int) = "download-${Profiles.activeId(context)}-$chapterId"

        const val TAG = "downloads"
    }
}
