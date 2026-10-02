package dev.fokuroru.reader.web

/** The server paths the native layer answers from disk or keeps a copy of. */
sealed interface Route {
    data class Page(val chapterId: Int, val page: Int) : Route
    data class Manifest(val chapterId: Int) : Route
    data object Stashed : Route
}

object Routes {
    private val page = Regex("^/api/v1/reader/chapter/(\\d+)/(?:page|thumb)/(\\d+)$")
    private val manifest = Regex("^/api/v1/reader/chapter/(\\d+)$")
    private val stashed = listOf(
        Regex("^/initialize\\.json$"),
        Regex("^/api/v1/auth/me$"),
        Regex("^/api/v1/reader/used$"),
        Regex("^/api/v1/readingprofiles$"),
        Regex("^/api/v1/reader/chapter/\\d+/bookmarks$"),
        Regex("^/api/v1/reader/series/\\d+/progress$"),
    )

    fun parse(path: String): Route? {
        page.matchEntire(path)?.let { return Route.Page(it.groupValues[1].toInt(), it.groupValues[2].toInt()) }
        manifest.matchEntire(path)?.let { return Route.Manifest(it.groupValues[1].toInt()) }
        if (stashed.any { it.matches(path) }) return Route.Stashed
        return null
    }

    /** The in-app path to open a chapter. */
    fun reader(chapterId: Int) = "/read/$chapterId"

    fun isReader(path: String?) = path != null && path.startsWith("/read/")
}
