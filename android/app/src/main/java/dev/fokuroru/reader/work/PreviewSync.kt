package dev.fokuroru.reader.work

import android.content.Context
import dev.fokuroru.reader.data.Previews
import dev.fokuroru.reader.net.Api
import dev.fokuroru.reader.net.HttpStatusException
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.URLEncoder

/**
 * Copies the previews the server has already downloaded onto the device, so they open with no
 * connection. The server's list is the truth: a preview it dropped is dropped here too.
 */
object PreviewSync {
    private const val MAX_PREVIEWS = 40

    fun run(context: Context, api: Api) {
        val cards = api.getArray("/api/v1/preview/cached")
        val saved = JSONArray()
        val keep = HashSet<Long>()
        for (i in 0 until minOf(cards.length(), MAX_PREVIEWS)) {
            val card = cards.getJSONObject(i)
            val id = card.optString("providerId").toLongOrNull() ?: continue
            if (!save(context, api, id)) continue
            keep.add(id)
            saved.put(card)
        }
        Previews.cardsFile(context).writeText(saved.toString())
        Previews.prune(context, keep)
    }

    /** True when every page of the preview is on the device. A failure leaves what was kept for the next pass. */
    private fun save(context: Context, api: Api, id: Long): Boolean {
        val snapshot = try {
            api.getObject("/api/v1/preview/$id")
        } catch (e: HttpStatusException) {
            if (e.status == 404) return false
            throw e
        }
        try {
            if (snapshot.optString("status") != "ready") return Previews.isSaved(context, id)
            val pageCount = snapshot.optInt("pageCount")
            val version = snapshot.optString("version")
            val query = if (version.isNotEmpty()) "?v=" + URLEncoder.encode(version, "UTF-8") else ""
            val current = Previews.snapshotFile(context, id)
            // A switched source changes the version and with it every page.
            if (current.isFile && JSONObject(current.readText()).optString("version") != version) {
                current.delete()
                for (page in 0 until pageCount) Previews.pageFile(context, id, page).delete()
            }
            for (page in 0 until pageCount) {
                val file = Previews.pageFile(context, id, page)
                if (!file.isFile) api.download("/api/v1/preview/$id/page/$page$query", file)
            }
            current.writeText(snapshot.toString())
            return true
        } catch (_: IOException) {
            return Previews.isSaved(context, id)
        } finally {
            release(api, id)
        }
    }

    /** Reading the snapshot registers this account as a viewer on the server; the web reader releases the same way. */
    private fun release(api: Api, id: Long) {
        try {
            val conn = api.open("/api/v1/preview/$id", "DELETE")
            try {
                conn.responseCode
            } finally {
                conn.disconnect()
            }
        } catch (_: IOException) {
        }
    }
}
