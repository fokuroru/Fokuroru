package dev.fokuroru.reader.net

import android.content.Context
import android.webkit.CookieManager
import dev.fokuroru.reader.Prefs
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.util.Locale

open class AuthExpiredException(message: String = "Signed out") : IOException(message)

/** A sign-in page from something in front of the server answered instead of the server. */
class GatewayException(val location: String?) : AuthExpiredException("Server sign-in needed")

class HttpStatusException(val status: Int) : IOException("HTTP $status")

/**
 * The server's own web UI signs in with a session cookie that lives in the WebView's cookie jar.
 * Background work reads that same jar, so there is no second login and no key to mint. Mutations
 * echo the antiforgery cookie as a header, exactly as the web client does.
 */
class Api(context: Context) {
    private val prefs = Prefs(context)

    val base: String get() = prefs.serverUrl ?: throw IOException("No server configured")

    fun url(path: String): String = if (path.startsWith("http")) path else base + path

    private fun cookies(): String? = CookieManager.getInstance().getCookie(base)

    fun open(path: String, method: String = "GET", body: String? = null, headers: Map<String, String> = emptyMap()): HttpURLConnection {
        val conn = URL(url(path)).openConnection() as HttpURLConnection
        conn.requestMethod = method
        conn.connectTimeout = 10_000
        conn.readTimeout = 30_000
        // Followed by hand: a redirect to another host is a gateway's sign-in page, not an answer.
        conn.instanceFollowRedirects = false
        conn.setRequestProperty("Accept-Language", Locale.getDefault().toLanguageTag())
        conn.setRequestProperty("X-Maki-Language", Locale.getDefault().language)
        cookies()?.let { jar ->
            conn.setRequestProperty("Cookie", jar)
            if (method != "GET" && method != "HEAD") xsrf(jar)?.let { conn.setRequestProperty("X-XSRF-TOKEN", it) }
        }
        headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
        if (body != null) {
            conn.doOutput = true
            conn.setRequestProperty("Content-Type", "application/json")
            conn.outputStream.use { it.write(body.toByteArray()) }
        }
        return conn
    }

    /** Persists cookies the server rotated, notably the antiforgery token reissued on every GET. */
    fun keepCookies(conn: HttpURLConnection) {
        val jar = CookieManager.getInstance()
        conn.headerFields["Set-Cookie"]?.forEach { jar.setCookie(base, it) }
        jar.flush()
    }

    fun checked(conn: HttpURLConnection, expectJson: Boolean = true): HttpURLConnection {
        keepCookies(conn)
        val status = Gateway.status(conn)
        if (status in 300..399) {
            val location = conn.getHeaderField("Location")
            if (Gateway.leavesHost(location, Gateway.hostOf(base))) throw GatewayException(location)
            throw HttpStatusException(status)
        }
        if (status == 401) throw AuthExpiredException()
        if (status !in 200..299) throw HttpStatusException(status)
        if (expectJson && conn.contentType?.contains("html", ignoreCase = true) == true) throw GatewayException(null)
        return conn
    }

    /** A GET that follows redirects within the server and stops at the first one that leaves it. */
    private fun get(path: String, expectJson: Boolean): HttpURLConnection {
        var target = path
        repeat(4) {
            val conn = open(target)
            val status = Gateway.status(conn)
            val location = conn.getHeaderField("Location")
            if (status in 300..399 && location != null && !Gateway.leavesHost(location, Gateway.hostOf(base))) {
                conn.disconnect()
                target = if (location.startsWith("http")) location else base + location
                return@repeat
            }
            return checked(conn, expectJson)
        }
        throw HttpStatusException(310)
    }

    fun getText(path: String, json: Boolean = true): String {
        val conn = get(path, json)
        try {
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    fun getObject(path: String) = JSONObject(getText(path))

    fun getArray(path: String) = JSONArray(getText(path))

    fun putJson(path: String, body: JSONObject): String {
        val conn = checked(open(path, "PUT", body.toString()))
        try {
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    /** Streams a response to [dest] through a temp file so a dropped connection never leaves half a page. */
    fun download(path: String, dest: File, isCancelled: () -> Boolean = { false }): Long {
        dest.parentFile?.mkdirs()
        // Unique per call: two requests for the same file at once must not write into one temp file.
        val part = File(dest.parentFile, dest.name + "." + System.nanoTime() + ".part")
        val conn = get(path, expectJson = false)
        try {
            var total = 0L
            conn.inputStream.use { input ->
                part.outputStream().use { out ->
                    val buffer = ByteArray(32 * 1024)
                    while (true) {
                        if (isCancelled()) throw IOException("Cancelled")
                        val n = input.read(buffer)
                        if (n < 0) break
                        out.write(buffer, 0, n)
                        total += n
                    }
                }
            }
            if (!part.renameTo(dest)) throw IOException("Couldn't store ${dest.name}")
            return total
        } catch (e: IOException) {
            part.delete()
            throw e
        } finally {
            conn.disconnect()
        }
    }

    /** Where the gateway said to sign in, from the last probe that met one. */
    @Volatile var gatewayLogin: String? = null
        private set

    /** One anonymous request to see whether the server answers, and as itself. Blocks. */
    /** The server's own build version, or null when it can't be read. */
    fun serverVersion(): String? = try {
        val conn = open("/initialize.json")
        conn.connectTimeout = 4_000
        conn.readTimeout = 6_000
        try {
            keepCookies(conn)
            if (Gateway.status(conn) == 200) org.json.JSONObject(conn.inputStream.use { String(it.readBytes()) }).optString("version").ifEmpty { null } else null
        } finally {
            conn.disconnect()
        }
    } catch (_: Exception) {
        null
    }

    fun probe(): ServerState = try {
        var target = "/initialize.json"
        var result: ServerState? = null
        repeat(3) {
            if (result != null) return@repeat
            val conn = open(target)
            conn.connectTimeout = 4_000
            conn.readTimeout = 6_000
            try {
                keepCookies(conn)
                val location = conn.getHeaderField("Location")
                result = Gateway.classify(Gateway.status(conn), conn.contentType, location, Gateway.hostOf(base))
                if (result == ServerState.GATEWAY) {
                    gatewayLogin = Gateway.loginUrl(
                        mapOf("x-tinyauth-location" to (conn.getHeaderField("x-tinyauth-location") ?: ""), "location" to (location ?: ""))
                            .filterValues { it.isNotEmpty() },
                        Gateway.hostOf(base),
                    )
                }
                if (result == null && location != null) target = if (location.startsWith("http")) location else base + location
            } finally {
                conn.disconnect()
            }
        }
        result ?: ServerState.UNREACHABLE
    } catch (_: IOException) {
        ServerState.UNREACHABLE
    }

    companion object {
        fun xsrf(cookieHeader: String): String? =
            cookieHeader.split(';').map { it.trim() }
                .firstOrNull { it.startsWith("XSRF-TOKEN=") }
                ?.substringAfter('=')
                ?.let { URLDecoder.decode(it, "UTF-8") }
    }
}
