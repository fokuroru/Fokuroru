package dev.fokuroru.reader.web

/** The server paths the native layer answers from disk or keeps a copy of. */
sealed interface Route {
    data class Page(val chapterId: Int, val page: Int) : Route
    data class Manifest(val chapterId: Int) : Route
    data class Cover(val seriesId: Int) : Route
    data object Stashed : Route
}

object Routes {
    private val page = Regex("^/api/v1/reader/chapter/(\\d+)/(?:page|thumb)/(\\d+)$")
    private val manifest = Regex("^/api/v1/reader/chapter/(\\d+)$")
    private val cover = Regex("^/api/v1/mediacover/(\\d+)/cover\\.jpg$")
    private val stashed = listOf(
        Regex("^/initialize\\.json$"),
        Regex("^/api/v1/auth/me$"),
        Regex("^/api/v1/reader/used$"),
        Regex("^/api/v1/readingprofiles$"),
        Regex("^/api/v1/reader/chapter/\\d+/bookmarks$"),
        Regex("^/api/v1/reader/series/\\d+/progress$"),
        Regex("^/api/v1/reader/tap-zones/(?:app|web)$"),
        // What Home draws from; served from the last copy, narrowed to saved series, when the server is away.
        Regex("^/api/v1/series$"),
        Regex("^/api/v1/home/(?:reading|recently-added|fresh|from-anime)$"),
        Regex("^/api/v1/settings/(?:ui|metadata)$"),
        Regex("^/api/v1/rootfolder$"),
        Regex("^/api/v1/progress/summary$"),
        Regex("^/api/v1/rails$"),
        Regex("^/api/v1/queue$"),
    )

    fun parse(path: String): Route? {
        page.matchEntire(path)?.let { return Route.Page(it.groupValues[1].toInt(), it.groupValues[2].toInt()) }
        manifest.matchEntire(path)?.let { return Route.Manifest(it.groupValues[1].toInt()) }
        cover.matchEntire(path)?.let { return Route.Cover(it.groupValues[1].toInt()) }
        if (stashed.any { it.matches(path) }) return Route.Stashed
        return null
    }

    /** The in-app path to open a chapter. */
    fun reader(chapterId: Int) = "/read/$chapterId"

    fun isReader(path: String?) = path != null && path.startsWith("/read/")
}
