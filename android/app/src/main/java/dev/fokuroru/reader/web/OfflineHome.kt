package dev.fokuroru.reader.web

import dev.fokuroru.reader.data.Download
import dev.fokuroru.reader.data.State
import dev.fokuroru.reader.data.Store
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

/**
 * What Home needs from the server, built from the chapters on the device. Used only when the server is away
 * and no earlier copy of an answer was kept (a fresh install, or a server that has never answered this build).
 */
object OfflineHome {
    fun answer(path: String, store: Store): ByteArray? {
        val saved = store.all().filter { it.state == State.DONE && it.seriesId > 0 }
        val body: Any = when (path) {
            "/api/v1/settings/ui" -> ui()
            "/api/v1/series" -> JSONArray(saved.groupBy { it.seriesId }.values.map { series(it) })
            "/api/v1/home/reading" -> reading(saved)
            "/api/v1/home/recently-added" -> recent(saved)
            "/api/v1/home/fresh", "/api/v1/rootfolder", "/api/v1/rails" -> JSONArray()
            "/api/v1/home/from-anime" -> JSONObject().put("items", JSONArray()).put("total", 0)
            "/api/v1/settings/metadata" -> JSONObject().put("useLocalDb", false).put("dumpPresent", false)
            "/api/v1/progress/summary" -> JSONObject().put("enabled", false)
            "/api/v1/queue" -> JSONObject().put("items", JSONArray()).put("total", 0).put("page", 1).put("pageSize", 200)
            else -> return null
        }
        return body.toString().toByteArray()
    }

    private fun cover(seriesId: Int) = "/api/v1/mediacover/$seriesId/cover.jpg"

    private fun iso(ms: Long) = Instant.ofEpochMilli(if (ms > 0) ms else 0).toString()

    private fun ui(): JSONObject {
        val sections = JSONArray()
        for (key in listOf("continue", "jumpback", "recent")) {
            sections.put(JSONObject().put("key", key).put("enabled", true).put("hero", JSONObject.NULL).put("panels", JSONObject.NULL))
        }
        return JSONObject()
            .put("startPage", "home")
            .put("homeLayout", JSONObject().put("enabled", true).put("sections", sections))
            .put("seriesSections", JSONObject().put("related", false).put("similar", false))
            .put("titleLanguage", "").put("language", "")
    }

    private fun series(chapters: List<Download>): JSONObject {
        val first = chapters.first()
        return JSONObject()
            .put("id", first.seriesId).put("title", first.seriesTitle).put("displayTitle", first.seriesTitle)
            .put("sortTitle", first.seriesTitle).put("originalTitle", JSONObject.NULL).put("altTitles", JSONArray())
            .put("status", "").put("type", JSONObject.NULL).put("overview", JSONObject.NULL).put("year", JSONObject.NULL)
            .put("genres", JSONArray()).put("metadataTags", JSONArray()).put("contentRating", JSONObject.NULL)
            .put("tagIds", JSONArray()).put("monitored", false).put("monitorNewItems", "None")
            .put("rootFolderId", 0).put("folderName", "").put("rootFolderPath", JSONObject.NULL)
            .put("coverUrl", cover(first.seriesId)).put("links", JSONArray())
            .put("added", iso(chapters.minOf { it.addedAt }))
            .put("wantedChapterCount", 0).put("chapterFileCount", chapters.size).put("knownChapterCount", chapters.size)
            .put("queuedCount", 0).put("downloadingCount", 0).put("hasAnime", false)
            .put("readChapterCount", JSONObject.NULL).put("sourceMatchPending", false)
            .put("incognito", "").put("notificationMode", "")
    }

    private fun reading(saved: List<Download>): JSONObject {
        val continueReading = JSONArray()
        val jumpBackIn = JSONArray()
        val picks = saved.groupBy { it.seriesId }.values.mapNotNull { chapters ->
            val unread = chapters.filter { !it.completed }.sortedBy { it.chapterId }
            val started = unread.filter { it.lastPage > 0 }.maxByOrNull { it.readAt }
            val pick = started ?: unread.firstOrNull() ?: return@mapNotNull null
            Triple(pick, unread.size, started != null)
        }.sortedByDescending { it.first.readAt }
        for ((pick, unread, started) in picks) {
            val item = JSONObject()
                .put("seriesId", pick.seriesId).put("seriesTitle", pick.seriesTitle).put("coverUrl", cover(pick.seriesId))
                .put("chapterId", pick.chapterId).put("chapterLabel", pick.label)
                .put("page", pick.lastPage).put("pageCount", pick.pageCount)
                .put("lastReadAt", iso(pick.readAt)).put("unreadChapters", unread)
            (if (started) continueReading else jumpBackIn).put(item)
        }
        return JSONObject().put("continueReading", continueReading).put("jumpBackIn", jumpBackIn)
    }

    private fun recent(saved: List<Download>): JSONArray = JSONArray(
        saved.groupBy { it.seriesId }.values.sortedByDescending { c -> c.maxOf { it.addedAt } }.map { chapters ->
            JSONObject()
                .put("seriesId", chapters.first().seriesId).put("seriesTitle", chapters.first().seriesTitle)
                .put("coverUrl", cover(chapters.first().seriesId)).put("addedAt", iso(chapters.maxOf { it.addedAt }))
                .put("newChapterCount", chapters.size).put("newestChapterLabel", JSONObject.NULL)
                .put("readChapterId", chapters.filter { !it.completed }.minByOrNull { it.chapterId }?.chapterId ?: JSONObject.NULL)
        },
    )
}
