package dev.fokuroru.reader.net

object Versions {
    /** Numeric parts compared in order, so 0.31.1-fok.66 is newer than 0.31.1-fok.9. */
    fun compare(a: String, b: String): Int {
        fun parts(v: String) = v.split(Regex("\\D+")).filter { it.isNotEmpty() }.map { it.toLong() }
        val x = parts(a)
        val y = parts(b)
        for (i in 0 until maxOf(x.size, y.size)) {
            val d = (x.getOrElse(i) { 0 }).compareTo(y.getOrElse(i) { 0 })
            if (d != 0) return d
        }
        return 0
    }
}
