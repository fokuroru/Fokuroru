package dev.fokuroru.reader.data

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import java.io.File

object State {
    const val QUEUED = "queued"
    const val DOWNLOADING = "downloading"
    const val DONE = "done"
    const val FAILED = "failed"
}

data class Download(
    val chapterId: Int,
    val seriesId: Int,
    val seriesTitle: String,
    val label: String,
    val pageCount: Int,
    val pagesDone: Int,
    val state: String,
    val bytes: Long,
    val manifest: String?,
    val addedAt: Long,
    val readAt: Long,
    val lastPage: Int,
    val completed: Boolean,
    val error: String?,
)

class Store private constructor(private val context: Context, val profileId: Long) :
    SQLiteOpenHelper(context, "fokuroru-$profileId.db", null, 1) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """CREATE TABLE downloads (
                chapter_id INTEGER PRIMARY KEY,
                series_id INTEGER NOT NULL DEFAULT 0,
                series_title TEXT NOT NULL DEFAULT '',
                label TEXT NOT NULL DEFAULT '',
                page_count INTEGER NOT NULL DEFAULT 0,
                pages_done INTEGER NOT NULL DEFAULT 0,
                state TEXT NOT NULL,
                bytes INTEGER NOT NULL DEFAULT 0,
                manifest TEXT,
                added_at INTEGER NOT NULL,
                read_at INTEGER NOT NULL DEFAULT 0,
                last_page INTEGER NOT NULL DEFAULT 0,
                completed INTEGER NOT NULL DEFAULT 0,
                error TEXT
            )""",
        )
        db.execSQL(
            """CREATE TABLE progress_queue (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                chapter_id INTEGER NOT NULL,
                page INTEGER NOT NULL,
                completed INTEGER NOT NULL,
                seconds INTEGER NOT NULL,
                final INTEGER NOT NULL,
                at INTEGER NOT NULL
            )""",
        )
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

    // ---- files ----

    private val root = Profiles.dir(context, profileId)

    fun chapterDir(chapterId: Int) = File(root, "chapters/$chapterId")

    fun pageFile(chapterId: Int, page: Int) = File(chapterDir(chapterId), page.toString())

    // ---- downloads ----

    fun queue(chapterId: Int): Boolean {
        val existing = get(chapterId)
        if (existing != null && existing.state == State.DONE) return false
        val values = ContentValues().apply {
            put("chapter_id", chapterId)
            put("state", State.QUEUED)
            put("added_at", System.currentTimeMillis())
            putNull("error")
        }
        if (existing == null) {
            writableDatabase.insert("downloads", null, values)
        } else {
            writableDatabase.update(
                "downloads", ContentValues().apply { put("state", State.QUEUED); putNull("error") },
                "chapter_id = ?", arrayOf(chapterId.toString()),
            )
        }
        return true
    }

    fun get(chapterId: Int): Download? =
        readableDatabase.query("downloads", null, "chapter_id = ?", arrayOf(chapterId.toString()), null, null, null)
            .use { if (it.moveToFirst()) it.toDownload() else null }

    fun all(): List<Download> =
        readableDatabase.query("downloads", null, null, null, null, null, "series_title COLLATE NOCASE, chapter_id")
            .use { c -> buildList { while (c.moveToNext()) add(c.toDownload()) } }

    fun doneIds(): List<Int> =
        readableDatabase.query(
            "downloads", arrayOf("chapter_id"), "state = ?", arrayOf(State.DONE), null, null, null,
        ).use { c -> buildList { while (c.moveToNext()) add(c.getInt(0)) } }

    fun hasChapter(chapterId: Int): Boolean =
        readableDatabase.query(
            "downloads", arrayOf("chapter_id"), "chapter_id = ? AND state = ?",
            arrayOf(chapterId.toString(), State.DONE), null, null, null,
        ).use { it.moveToFirst() }

    fun setManifest(chapterId: Int, seriesId: Int, seriesTitle: String, label: String, pageCount: Int, manifest: String) {
        update(chapterId) {
            put("series_id", seriesId)
            put("series_title", seriesTitle)
            put("label", label)
            put("page_count", pageCount)
            put("manifest", manifest)
            put("state", State.DOWNLOADING)
        }
    }

    fun pageDone(chapterId: Int, pagesDone: Int, bytes: Long) {
        update(chapterId) { put("pages_done", pagesDone); put("bytes", bytes) }
    }

    fun finish(chapterId: Int) = update(chapterId) { put("state", State.DONE); putNull("error") }

    fun fail(chapterId: Int, error: String?) =
        update(chapterId) { put("state", State.FAILED); put("error", error ?: "") }

    fun setState(chapterId: Int, state: String) = update(chapterId) { put("state", state) }

    fun delete(chapterId: Int) {
        writableDatabase.delete("downloads", "chapter_id = ?", arrayOf(chapterId.toString()))
        chapterDir(chapterId).deleteRecursively()
    }

    // ---- local reading state ----

    fun setLocalProgress(chapterId: Int, page: Int, completed: Boolean) {
        val current = get(chapterId) ?: return
        update(chapterId) {
            put("last_page", page)
            put("read_at", System.currentTimeMillis())
            if (completed) put("completed", 1) else if (current.completed && page == 0) put("completed", 0)
        }
    }

    /** Server truth, applied after a sync. A newer local read keeps its position. */
    fun applyServerProgress(chapterId: Int, page: Int, completed: Boolean, updatedAt: Long) {
        val current = get(chapterId) ?: return
        if (current.readAt > updatedAt && !completed) return
        update(chapterId) {
            put("last_page", page)
            put("completed", if (completed) 1 else 0)
            put("read_at", maxOf(current.readAt, updatedAt))
        }
    }

    fun deletable(): List<DownloadedChapter> {
        val pending = pendingChapterIds()
        return all().filter { it.state == State.DONE }
            .map { DownloadedChapter(it.chapterId, it.seriesId, it.completed, it.readAt, it.chapterId in pending) }
    }

    // ---- progress queue ----

    fun enqueueProgress(chapterId: Int, page: Int, completed: Boolean, seconds: Int, final: Boolean) {
        writableDatabase.insert(
            "progress_queue", null,
            ContentValues().apply {
                put("chapter_id", chapterId)
                put("page", page)
                put("completed", if (completed) 1 else 0)
                put("seconds", seconds)
                put("final", if (final) 1 else 0)
                put("at", System.currentTimeMillis())
            },
        )
        setLocalProgress(chapterId, page, completed)
    }

    fun queuedProgress(): List<QueuedProgress> =
        readableDatabase.query("progress_queue", null, null, null, null, null, "at, id").use { c ->
            buildList {
                while (c.moveToNext()) {
                    add(
                        QueuedProgress(
                            id = c.getLong(c.getColumnIndexOrThrow("id")),
                            chapterId = c.getInt(c.getColumnIndexOrThrow("chapter_id")),
                            page = c.getInt(c.getColumnIndexOrThrow("page")),
                            completed = c.getInt(c.getColumnIndexOrThrow("completed")) != 0,
                            seconds = c.getInt(c.getColumnIndexOrThrow("seconds")),
                            final = c.getInt(c.getColumnIndexOrThrow("final")) != 0,
                            at = c.getLong(c.getColumnIndexOrThrow("at")),
                        ),
                    )
                }
            }
        }

    fun removeQueued(ids: Collection<Long>) {
        if (ids.isEmpty()) return
        writableDatabase.delete("progress_queue", "id IN (${ids.joinToString(",")})", null)
    }

    fun pendingChapterIds(): Set<Int> =
        readableDatabase.query(true, "progress_queue", arrayOf("chapter_id"), null, null, null, null, null, null)
            .use { c -> buildSet { while (c.moveToNext()) add(c.getInt(0)) } }

    fun queuedProgressFor(chapterId: Int): QueuedProgress? =
        queuedProgress().lastOrNull { it.chapterId == chapterId }

    private fun update(chapterId: Int, fill: ContentValues.() -> Unit) {
        writableDatabase.update("downloads", ContentValues().apply(fill), "chapter_id = ?", arrayOf(chapterId.toString()))
    }

    private fun Cursor.toDownload() = Download(
        chapterId = getInt(getColumnIndexOrThrow("chapter_id")),
        seriesId = getInt(getColumnIndexOrThrow("series_id")),
        seriesTitle = getString(getColumnIndexOrThrow("series_title")),
        label = getString(getColumnIndexOrThrow("label")),
        pageCount = getInt(getColumnIndexOrThrow("page_count")),
        pagesDone = getInt(getColumnIndexOrThrow("pages_done")),
        state = getString(getColumnIndexOrThrow("state")),
        bytes = getLong(getColumnIndexOrThrow("bytes")),
        manifest = getString(getColumnIndexOrThrow("manifest")),
        addedAt = getLong(getColumnIndexOrThrow("added_at")),
        readAt = getLong(getColumnIndexOrThrow("read_at")),
        lastPage = getInt(getColumnIndexOrThrow("last_page")),
        completed = getInt(getColumnIndexOrThrow("completed")) != 0,
        error = getString(getColumnIndexOrThrow("error")),
    )

    companion object {
        private val instances = HashMap<Long, Store>()

        /** The store of the profile in use. */
        @Synchronized
        fun get(context: Context): Store {
            val id = Profiles.activeId(context)
            return instances.getOrPut(id) { Store(context.applicationContext, id) }
        }

        @Synchronized
        fun forget(context: Context, id: Long) {
            instances.remove(id)?.close()
            context.applicationContext.deleteDatabase("fokuroru-$id.db")
        }
    }
}
