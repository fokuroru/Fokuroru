package dev.fokuroru.reader.web

import android.webkit.JavascriptInterface
import dev.fokuroru.reader.BuildConfig
import dev.fokuroru.reader.MainActivity
import dev.fokuroru.reader.data.Store
import dev.fokuroru.reader.work.DownloadWorker
import dev.fokuroru.reader.work.ProgressSync
import org.json.JSONArray
import org.json.JSONObject

/**
 * What the web UI sees as `window.MakiNative`. Every method checks that the page asking is the
 * configured server, so a stray frame can't queue downloads or rewrite progress.
 */
class WebBridge(private val activity: MainActivity) {
    private val store get() = Store.get(activity)

    @JavascriptInterface
    fun version(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface
    fun offline(): Boolean = activity.trusted() && activity.serverOffline()

    @JavascriptInterface
    fun layout(): String = activity.layoutJson()

    @JavascriptInterface
    fun queueProgress(chapterId: Int, page: Int, completed: Boolean, seconds: Int, final: Boolean) {
        if (!activity.trusted()) return
        store.enqueueProgress(chapterId, page, completed, seconds.coerceAtLeast(0), final)
        ProgressSync.schedule(activity)
    }

    @JavascriptInterface
    fun download(ids: String) {
        if (!activity.trusted()) return
        ints(ids).forEach { DownloadWorker.enqueue(activity, it) }
    }

    @JavascriptInterface
    fun removeDownload(ids: String) {
        if (!activity.trusted()) return
        ints(ids).forEach {
            DownloadWorker.cancel(activity, it)
            store.delete(it)
        }
        dev.fokuroru.reader.Events.downloadsChanged()
    }

    @JavascriptInterface
    fun downloads(): String {
        if (!activity.trusted()) return "[]"
        val out = JSONArray()
        store.all().forEach {
            out.put(
                JSONObject().put("id", it.chapterId).put("state", it.state)
                    .put("pagesDone", it.pagesDone).put("pageCount", it.pageCount),
            )
        }
        return out.toString()
    }

    @JavascriptInterface
    fun openSettings() {
        if (activity.trusted()) activity.runOnUiThread { activity.openSettings() }
    }

    @JavascriptInterface
    fun openDownloads() {
        if (activity.trusted()) activity.runOnUiThread { activity.openDownloads() }
    }

    @JavascriptInterface
    fun openReaderTools() {
        if (activity.trusted()) activity.runOnUiThread { activity.openReaderTools() }
    }

    private fun ints(json: String): List<Int> = try {
        val array = JSONArray(json)
        (0 until array.length()).map { array.getInt(it) }
    } catch (_: Exception) {
        emptyList()
    }
}
