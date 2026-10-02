package dev.fokuroru.reader

import java.util.Locale

object Strings {
    /** `1.5 MB`, `320 KB`. */
    fun bytes(n: Long): String = when {
        n >= 1L shl 30 -> String.format(Locale.US, "%.1f GB", n / (1L shl 30).toDouble())
        n >= 1L shl 20 -> String.format(Locale.US, "%.1f MB", n / (1L shl 20).toDouble())
        n >= 1L shl 10 -> String.format(Locale.US, "%d KB", n shr 10)
        else -> "$n B"
    }

    /** Trims a typed server address to scheme://host[:port][/base], assuming http on a bare host. */
    fun normaliseServer(raw: String): String? {
        var value = raw.trim()
        if (value.isEmpty() || value.any { it.isWhitespace() }) return null
        if (!value.contains("://")) value = "http://$value"
        val scheme = value.substringBefore("://").lowercase(Locale.ROOT)
        if (scheme != "http" && scheme != "https") return null
        val rest = value.substringAfter("://").trimEnd('/')
        if (rest.isEmpty() || rest.startsWith("/")) return null
        return "$scheme://$rest"
    }
}
