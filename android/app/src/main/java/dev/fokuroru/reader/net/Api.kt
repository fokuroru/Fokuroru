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

class AuthExpiredException : IOException("Signed out")

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
        conn.instanceFollowRedirects = true
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

    fun checked(conn: HttpURLConnection): HttpURLConnection {
        keepCookies(conn)
        val status = conn.responseCode
        if (status == 401) throw AuthExpiredException()
        if (status !in 200..299) throw HttpStatusException(status)
        return conn
    }

    fun getText(path: String): String {
        val conn = checked(open(path))
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
        val conn = checked(open(path))
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

    fun reachable(): Boolean = try {
        val conn = open("/initialize.json")
        conn.connectTimeout = 2_500
        conn.readTimeout = 2_500
        try {
            conn.responseCode in 200..299
        } finally {
            conn.disconnect()
        }
    } catch (_: IOException) {
        false
    }

    companion object {
        fun xsrf(cookieHeader: String): String? =
            cookieHeader.split(';').map { it.trim() }
                .firstOrNull { it.startsWith("XSRF-TOKEN=") }
                ?.substringAfter('=')
                ?.let { URLDecoder.decode(it, "UTF-8") }
    }
}
