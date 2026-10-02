package dev.fokuroru.reader.web

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import dev.fokuroru.reader.data.Profiles
import dev.fokuroru.reader.data.Store
import dev.fokuroru.reader.net.Api
import dev.fokuroru.reader.net.Gateway
import dev.fokuroru.reader.net.ServerState
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
    private val stashDir = File(Profiles.activeDir(context), "stash").apply { mkdirs() }

    @Volatile private var reachableAt = 0L
    @Volatile private var state = ServerState.OK

    /** Told when a page needs the server's sign-in state and neither the server nor a saved copy can give it. */
    var onUnavailable: (() -> Unit)? = null

    fun gatewayLoginUrl(): String? = api.gatewayLogin

    /** Told whenever the server's state changes, from whichever thread noticed. */
    var onState: ((ServerState) -> Unit)? = null

    /** Set when the person asked to sign in again: the next page load must go to the network, not the saved copy. */
    @Volatile private var forceNetwork = false

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
            // Not fetched here on a miss: the web view's own loader is much faster on a cold start, and
            // refreshShell() fills the cache once the page is up.
            return shell.asset(path)
        }
        if (request.isForMainFrame) reachableAt = 0
        val isPage = request.isForMainFrame && !path.startsWith("/api/") && !path.substringAfterLast('/').contains('.')
        if (isPage && shell.hasIndex() && !forceNetwork && !serverReachable()) return shell.index()
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
    fun probeState(): ServerState {
        val now = System.currentTimeMillis()
        // A bad answer is rechecked soon: signing in at a gateway changes it within seconds.
        if (now - reachableAt < if (state == ServerState.OK) 8_000 else 1_500) return state
        reachableAt = now
        setState(if (isOnline()) api.probe() else ServerState.UNREACHABLE)
        return state
    }

    fun serverReachable(): Boolean = probeState() == ServerState.OK

    private fun setState(next: ServerState) {
        if (state == next) return
        state = next
        onState?.invoke(next)
    }

    /** What the last probes found, without probing: the web layer asks on every progress write. */
    fun knownUnreachable(): Boolean =
        !isOnline() || (state != ServerState.OK && System.currentTimeMillis() - reachableAt < 60_000)

    fun forgetReachability() {
        reachableAt = 0
    }

    /** The person is about to sign in at the gateway's page: let that load through, not the saved copy. */
    fun signInAgain() {
        forceNetwork = true
        reachableAt = 0
    }

    /** Back on the server's own page after signing in. */
    fun signedIn() {
        forceNetwork = false
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

        // Tried whenever there is a network, not only after a probe passed: a slow first connection can fail
        // a short probe while the real request would have gone through, and that must not look like offline.
        if (isOnline()) {
            try {
                val headers = request.requestHeaders.filterKeys { name ->
                    FORWARD_BLOCKED.none { it.equals(name, true) }
                }
                val conn = api.open(request.url.toString().removePrefix(api.base), "GET", null, headers)
                conn.connectTimeout = 4_000
                conn.readTimeout = 8_000
                try {
                    api.keepCookies(conn)
                    val status = Gateway.status(conn)
                    if (status in 300..399 && Gateway.leavesHost(conn.getHeaderField("Location"), Gateway.hostOf(api.base))) {
                        setState(ServerState.GATEWAY)
                        throw IOException("gateway")
                    }
                    if (status == 401) {
                        stashDir.listFiles()?.forEach { it.delete() }
                    }
                    val stream = if (status in 200..299) conn.inputStream else conn.errorStream
                    val bytes = stream?.use { it.readBytes() } ?: ByteArray(0)
                    if (status in 200..299) {
                        setState(ServerState.OK)
                        reachableAt = System.currentTimeMillis()
                        file.writeBytes(bytes)
                        if (request.url.path == "/api/v1/auth/me") rememberUser(bytes)
                    }
                    return WebResourceResponse(
                        conn.contentType?.substringBefore(';') ?: "application/json", "utf-8",
                        status, conn.responseMessage ?: "OK",
                        mapOf("Cache-Control" to "no-store"), ByteArrayInputStream(bytes),
                    )
                } finally {
                    conn.disconnect()
                }
            } catch (_: IOException) {
                if (state == ServerState.OK) setState(ServerState.UNREACHABLE)
            }
        }
        if (file.isFile) return json(200, file.readBytes())
        val path = request.url.path
        // Nothing to boot the page from: the server's anonymous start-up answer is the same for everyone, so
        // a stand-in lets the page start, and the missing sign-in state is then reported rather than guessed.
        if (path == "/initialize.json") return json(200, OFFLINE_INITIALIZE.toByteArray())
        if (path == "/api/v1/auth/me") onUnavailable?.invoke()
        return json(503, "{\"error\":\"offline\"}".toByteArray())
    }

    /** The account name goes into the profile list, so two accounts on one server can be told apart. */
    private fun rememberUser(body: ByteArray) {
        val name = try {
            JSONObject(String(body)).optString("userName")
        } catch (_: Exception) {
            ""
        }
        if (name.isNotEmpty()) Profiles.rememberUser(context, name)
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
        const val OFFLINE_INITIALIZE =
            "{\"apiRoot\":\"/api/v1\",\"version\":\"offline\",\"setupNeeded\":false," +
                "\"oidc\":{\"enabled\":false,\"displayName\":\"\",\"localLoginRestricted\":false}}"
    }
}
