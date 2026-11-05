package dev.fokuroru.reader.data

import android.content.Context
import java.io.File

/**
 * First-chapter previews the server already holds, kept on the device so they open with no server.
 * A preview counts as saved once its snapshot file exists: that is written last, after every page.
 */
object Previews {
    private fun root(context: Context) = File(Profiles.activeDir(context), "previews").apply { mkdirs() }

    private fun dir(context: Context, providerId: Long) = File(root(context), providerId.toString())

    fun cardsFile(context: Context) = File(root(context), "cards.json")

    fun snapshotFile(context: Context, providerId: Long) = File(dir(context, providerId), "snapshot.json")

    fun pageFile(context: Context, providerId: Long, page: Int) = File(dir(context, providerId), page.toString())

    fun isSaved(context: Context, providerId: Long) = snapshotFile(context, providerId).isFile

    /** Drops every saved preview the server no longer lists, so storage follows the server's set. */
    fun prune(context: Context, keep: Set<Long>) {
        root(context).listFiles()?.forEach { f ->
            val id = f.name.toLongOrNull() ?: return@forEach
            if (id !in keep) f.deleteRecursively()
        }
    }
}
