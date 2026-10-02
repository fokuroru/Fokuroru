package dev.fokuroru.reader.web

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import dev.fokuroru.reader.data.Store
import dev.fokuroru.reader.net.Api
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.security.MessageDigest

/**
 * Answers the web reader's requests from disk when it can, so downloaded chapters open with no
 * network and no change to the web code.
 *
 * Pages come from storage whenever the chapter is saved, online or not. The manifest and a short list
 * of small JSON reads are passed through the app's own connection and remembered; when the server
 * can't be reached the last good copy is served instead.
 */
class Offline(private val context: Context) {
    private val api = Api(context)
    private val store = Store.get(context)
    private val shell = Shell(context, api)
    private val stashDir = File(context.filesDir, "stash").apply { mkdirs() }

    @Volatile private var reachableAt = 0L
    @Volatile private var reachable = true

    fun intercept(request: WebResourceRequest): WebResourceResponse? {
        if (request.method != "GET") return null
        val uri = request.url
        val server = android.net.Uri.parse(api.base)
        if (uri.host != server.host || uri.port != server.port) return null

        val path = uri.path ?: return null
        return when (val route = Routes.parse(path)) {
            is Route.Page -> page(route)
            is Route.Manifest -> manifest(route)
            Route.Stashed -> stashed(request)
            null -> shellFile(request, path)
        }
    }

    /** Build files come from disk once kept; a navigation with no server falls back to the saved entry page. */
    private fun shellFile(request: WebResourceRequest, path: String): WebResourceResponse? {
        if (path.startsWith("/assets/")) {
            shell.asset(path)?.let { return it }
            return if (serverReachable()) shell.fetch(path) else null
        }
        val isPage = request.isForMainFrame && !path.startsWith("/api/") && !path.substringAfterLast('/').contains('.')
        if (isPage && shell.hasIndex() && !serverReachable()) return shell.index()
        return null
    }

    /** Keeps the web app's files fresh; cheap when nothing changed. */
    fun refreshShell() {
        if (serverReachable()) shell.refresh()
    }

    fun isOnline(): Boolean {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET) ||
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) ||
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)
    }

    /** Cached for a few seconds: the reader asks for a dozen things at once. */
    @Synchronized
    fun serverReachable(): Boolean {
        val now = System.currentTimeMillis()
        if (now - reachableAt < 8_000) return reachable
        reachable = isOnline() && api.reachable()
        reachableAt = now
        return reachable
    }

    /** What the last probes found, without probing: the web layer asks on every progress write. */
    fun knownUnreachable(): Boolean =
        !isOnline() || (!reachable && System.currentTimeMillis() - reachableAt < 60_000)

    fun forgetReachability() {
        reachableAt = 0
    }

    private fun page(route: Route.Page): WebResourceResponse? {
        if (!store.hasChapter(route.chapterId)) return null
        val file = store.pageFile(route.chapterId, route.page)
        if (!file.isFile) return null
        return WebResourceResponse(sniff(file), null, 200, "OK", mapOf("Cache-Control" to "private, max-age=31536000"), FileInputStream(file))
    }

    private fun manifest(route: Route.Manifest): WebResourceResponse? {
        val saved = store.get(route.chapterId) ?: return null
        if (saved.state != "done" || saved.manifest == null) return null
        if (serverReachable()) return null

        val json = JSONObject(saved.manifest)
        val queued = store.queuedProgressFor(route.chapterId)
        val page = queued?.page ?: saved.lastPage
        val completed = queued?.completed ?: saved.completed
        json.put("resumePage", if (completed) 0 else page)
        json.put("completed", completed)
        // Neighbours are only readable offline when they are saved too.
        for (key in listOf("previousChapterId", "nextChapterId")) {
            val id = json.optInt(key, -1)
            if (id > 0 && !store.hasChapter(id)) {
                json.put(key, JSONObject.NULL)
                if (key == "nextChapterId") {
                    json.put("nextChapterLabel", JSONObject.NULL)
                    json.put("nextChapterNumber", JSONObject.NULL)
                }
            }
        }
        return json(200, json.toString().toByteArray())
    }

    private fun stashed(request: WebResourceRequest): WebResourceResponse? {
        val key = key(request.url.path + "?" + (request.url.query ?: ""))
        val file = File(stashDir, key)

        if (serverReachable()) {
            try {
                val headers = request.requestHeaders.filterKeys { name ->
                    FORWARD_BLOCKED.none { it.equals(name, true) }
                }
                val conn = api.open(request.url.toString().removePrefix(api.base), "GET", null, headers)
                try {
                    api.keepCookies(conn)
                    val status = conn.responseCode
                    if (status == 401) {
                        stashDir.listFiles()?.forEach { it.delete() }
                    }
                    val stream = if (status in 200..299) conn.inputStream else conn.errorStream
                    val bytes = stream?.use { it.readBytes() } ?: ByteArray(0)
                    if (status in 200..299) file.writeBytes(bytes)
                    return WebResourceResponse(
                        conn.contentType?.substringBefore(';') ?: "application/json", "utf-8",
                        status, conn.responseMessage ?: "OK",
                        mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(bytes),
                    )
                } finally {
                    conn.disconnect()
                }
            } catch (_: IOException) {
                reachable = false
            }
        }
        if (file.isFile) return json(200, file.readBytes())
        return json(503, "{\"error\":\"offline\"}".toByteArray())
    }

    private fun json(status: Int, body: ByteArray) = WebResourceResponse(
        "application/json", "utf-8", status, if (status == 200) "OK" else "Service Unavailable",
        mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(body),
    )

    private fun key(value: String): String =
        MessageDigest.getInstance("SHA-1").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

    private fun sniff(file: File): String {
        val head = ByteArray(12)
        val n = file.inputStream().use { it.read(head) }
        fun starts(vararg b: Int) = n >= b.size && b.indices.all { head[it] == b[it].toByte() }
        return when {
            starts(0x89, 0x50, 0x4E, 0x47) -> "image/png"
            starts(0x47, 0x49, 0x46) -> "image/gif"
            starts(0x52, 0x49, 0x46, 0x46) && n >= 12 && head[8] == 'W'.code.toByte() -> "image/webp"
            starts(0x00, 0x00, 0x00) && n >= 12 && head[4] == 'f'.code.toByte() -> "image/avif"
            else -> "image/jpeg"
        }
    }

    private companion object {
        val FORWARD_BLOCKED = listOf("Cookie", "Host", "Connection", "Accept-Encoding", "Content-Length")
    }
}
