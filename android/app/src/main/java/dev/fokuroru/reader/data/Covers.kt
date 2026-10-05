package dev.fokuroru.reader.data

import android.content.Context
import dev.fokuroru.reader.net.Api
import java.io.File
import java.io.IOException

/**
 * Series covers kept on the device, in the same folder the reading snapshot uses, so the saved-chapters
 * screen has art to show without the server. Fetched when a chapter is saved, and for chapters saved
 * before covers were kept, whenever the screen is opened with a connection.
 */
object Covers {
    fun file(context: Context, seriesId: Int): File = ReadingSnapshot.coverFile(context, seriesId)

    /** True when a cover is on the device afterwards. A failed fetch (offline, signed out) is not an error here. */
    fun ensure(context: Context, api: Api, seriesId: Int): Boolean {
        if (seriesId <= 0) return false
        val file = file(context, seriesId)
        if (file.isFile) return true
        return try {
            api.download("/api/v1/mediacover/$seriesId/cover.jpg", file)
            true
        } catch (_: IOException) {
            false
        }
    }
}
