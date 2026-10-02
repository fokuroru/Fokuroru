package dev.fokuroru.reader.web

import android.content.Context
import android.webkit.MimeTypeMap
import android.webkit.WebResourceResponse
import dev.fokuroru.reader.net.Api
import java.io.File
import java.io.FileInputStream
import java.io.IOException
import java.security.MessageDigest

/**
 * A copy of the web app's own files, kept on disk so the UI can start with no network.
 *
 * Servers reached over plain HTTP on a LAN are not secure contexts, which rules out the web app's
 * service worker there, so the shell is cached here instead. Build output is hashed and immutable,
 * which makes a file-per-path cache safe: a new build brings new names, and old ones are pruned.
 */
class Shell(context: Context, private val api: Api) {
    private val dir = File(context.filesDir, "shell").apply { mkdirs() }
    private val indexFile = File(dir, "index.html")

    fun hasIndex() = indexFile.isFile

    fun index(): WebResourceResponse =
        WebResourceResponse("text/html", "utf-8", 200, "OK", mapOf("Cache-Control" to "no-store"), FileInputStream(indexFile))

    fun asset(path: String): WebResourceResponse? {
        val file = fileFor(path)
        if (!file.isFile) return null
        return WebResourceResponse(
            mime(path), null, 200, "OK", mapOf("Cache-Control" to "public, max-age=31536000, immutable"), FileInputStream(file),
        )
    }

    /** Fetches one build file through the app's connection and keeps it. */
    fun fetch(path: String): WebResourceResponse? = try {
        api.download(path, fileFor(path))
        asset(path)
    } catch (_: IOException) {
        null
    }

    /** Re-reads the entry page and pulls in every file it can reach, so lazy routes work offline too. */
    fun refresh() {
        val html = try {
            api.getText("/")
        } catch (_: IOException) {
            return
        }
        if (!html.contains("<div id=\"root\"")) return
        indexFile.writeText(html)

        val wanted = LinkedHashSet<String>()
        val queue = ArrayDeque(references(html, "/"))
        while (queue.isNotEmpty() && wanted.size < MAX_FILES) {
            val path = queue.removeFirst()
            if (!wanted.add(path)) continue
            val file = fileFor(path)
            if (!file.isFile) {
                try {
                    api.download(path, file)
                } catch (_: IOException) {
                    continue
                }
            }
            if (path.endsWith(".js") || path.endsWith(".css")) {
                references(file.readText(), path).filter { it !in wanted }.forEach(queue::addLast)
            }
        }
        val keep = wanted.map { fileFor(it).name }.toSet() + indexFile.name
        dir.listFiles()?.filter { it.name !in keep }?.forEach { it.delete() }
    }

    private fun fileFor(path: String): File {
        val digest = MessageDigest.getInstance("SHA-1").digest(path.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(dir, digest.take(16) + "-" + path.substringAfterLast('/').take(60))
    }

    private fun mime(path: String): String =
        when (path.substringAfterLast('.', "").lowercase()) {
            "js", "mjs" -> "text/javascript"
            "css" -> "text/css"
            "woff2" -> "font/woff2"
            "woff" -> "font/woff"
            "ttf" -> "font/ttf"
            "svg" -> "image/svg+xml"
            else -> MimeTypeMap.getSingleton().getMimeTypeFromExtension(path.substringAfterLast('.', "")) ?: "application/octet-stream"
        }

    companion object {
        private const val MAX_FILES = 600

        private val assetRef = Regex("""(?<![\w/.-])/?(assets/[\w.\-@~]+\.(?:js|mjs|css|woff2?|ttf|svg|png|jpe?g|webp|gif|ico|json|glb))""")
        private val relativeRef = Regex("""["'`]\./([\w.\-@~]+\.(?:js|mjs|css))["'`]""")

        /** Numbered CJK font subsets (hundreds of files, fetched on demand) and the legacy `.woff` twins. */
        private val skip = Regex("""-\d+-\d{3}-(?:normal|italic)-|\.woff$""")
        private val cssUrl = Regex("""url\(\s*["']?([^)"'#?\s]+)""")
        private val htmlRef = Regex("""(?:src|href)=["']([^"']+)["']""")

        /** Paths of the build files `text` points at, as absolute server paths. */
        fun references(text: String, from: String): List<String> {
            val found = LinkedHashSet<String>()
            assetRef.findAll(text).forEach { found += "/" + it.groupValues[1] }
            if (from.endsWith(".js") || from.endsWith(".mjs")) {
                relativeRef.findAll(text).forEach { found += from.substringBeforeLast('/') + "/" + it.groupValues[1] }
            }
            if (from.endsWith(".css")) {
                cssUrl.findAll(text).forEach { m ->
                    val ref = m.groupValues[1]
                    if (ref.startsWith("data:") || ref.startsWith("http")) return@forEach
                    found += if (ref.startsWith("/")) ref else from.substringBeforeLast('/') + "/" + ref.removePrefix("./")
                }
            }
            if (from == "/") {
                htmlRef.findAll(text).forEach { m ->
                    val ref = m.groupValues[1]
                    if (ref.startsWith("/assets/")) found += ref
                }
            }
            return found.filter { it.startsWith("/assets/") && !skip.containsMatchIn(it) }
        }
    }
}
