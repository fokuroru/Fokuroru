package dev.fokuroru.reader.data

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

data class ReadingItem(
    val seriesId: Int,
    val title: String,
    val coverUrl: String?,
    val chapterId: Int,
    val label: String,
    val page: Int,
    val pageCount: Int,
    val unread: Int,
    val inProgress: Boolean,
) {
    fun toJson() = JSONObject()
        .put("seriesId", seriesId).put("title", title).put("coverUrl", coverUrl ?: JSONObject.NULL)
        .put("chapterId", chapterId).put("label", label).put("page", page).put("pageCount", pageCount)
        .put("unread", unread).put("inProgress", inProgress)

    companion object {
        fun from(o: JSONObject) = ReadingItem(
            seriesId = o.getInt("seriesId"),
            title = o.getString("title"),
            coverUrl = if (o.isNull("coverUrl")) null else o.getString("coverUrl"),
            chapterId = o.getInt("chapterId"),
            label = o.optString("label"),
            page = o.optInt("page"),
            pageCount = o.optInt("pageCount"),
            unread = o.optInt("unread"),
            inProgress = o.optBoolean("inProgress"),
        )
    }
}

data class LatestItem(val seriesId: Int, val title: String, val chapterId: Int?, val label: String?) {
    fun toJson() = JSONObject()
        .put("seriesId", seriesId).put("title", title)
        .put("chapterId", chapterId ?: JSONObject.NULL).put("label", label ?: JSONObject.NULL)

    companion object {
        fun from(o: JSONObject) = LatestItem(
            seriesId = o.getInt("seriesId"),
            title = o.getString("title"),
            chapterId = if (o.isNull("chapterId")) null else o.getInt("chapterId"),
            label = if (o.isNull("label")) null else o.getString("label"),
        )
    }
}

data class ReadingSnapshot(val updatedAt: Long, val items: List<ReadingItem>, val latest: LatestItem?) {
    /** The chapter "Continue reading" opens: what is in progress, else the first up-next. */
    fun continueTarget(): ReadingItem? = items.firstOrNull { it.inProgress } ?: items.firstOrNull()

    fun toJson() = JSONObject()
        .put("updatedAt", updatedAt)
        .put("items", JSONArray(items.map { it.toJson() }))
        .put("latest", latest?.toJson() ?: JSONObject.NULL)

    companion object {
        val EMPTY = ReadingSnapshot(0, emptyList(), null)

        fun parse(text: String): ReadingSnapshot {
            val o = JSONObject(text)
            val items = o.optJSONArray("items") ?: JSONArray()
            return ReadingSnapshot(
                o.optLong("updatedAt"),
                (0 until items.length()).map { ReadingItem.from(items.getJSONObject(it)) },
                if (o.isNull("latest")) null else LatestItem.from(o.getJSONObject("latest")),
            )
        }

        fun load(context: Context): ReadingSnapshot = try {
            val file = file(context)
            if (file.isFile) parse(file.readText()) else EMPTY
        } catch (_: Exception) {
            EMPTY
        }

        fun save(context: Context, snapshot: ReadingSnapshot) {
            file(context).writeText(snapshot.toJson().toString())
        }

        private fun file(context: Context) = File(Profiles.activeDir(context), "reading.json")

        fun coverFile(context: Context, seriesId: Int) = File(File(Profiles.activeDir(context), "covers"), "$seriesId.jpg")
    }
}
