package dev.fokuroru.reader

import dev.fokuroru.reader.data.AutoDelete
import dev.fokuroru.reader.data.DownloadedChapter
import org.junit.Assert.assertEquals
import org.junit.Test

class AutoDeleteTest {
    private fun ch(id: Int, series: Int, completed: Boolean, readAt: Long = 0, pending: Boolean = false) =
        DownloadedChapter(id, series, completed, readAt, pending)

    @Test
    fun unreadChaptersAreNeverDeleted() {
        assertEquals(emptyList<Int>(), AutoDelete.plan(listOf(ch(1, 1, false), ch(2, 1, false)), keepLast = false))
    }

    @Test
    fun readChaptersGoWhenKeepLastIsOff() {
        val plan = AutoDelete.plan(listOf(ch(1, 1, true, 10), ch(2, 1, true, 20), ch(3, 1, false)), keepLast = false)
        assertEquals(listOf(1, 2), plan)
    }

    @Test
    fun keepLastHoldsBackTheMostRecentlyReadPerSeries() {
        val plan = AutoDelete.plan(
            listOf(ch(1, 1, true, 10), ch(2, 1, true, 20), ch(3, 2, true, 5), ch(4, 2, true, 3)),
            keepLast = true,
        )
        assertEquals(listOf(1, 4), plan)
    }

    @Test
    fun aChapterWithUnsyncedProgressStays() {
        val plan = AutoDelete.plan(listOf(ch(1, 1, true, 10, pending = true), ch(2, 1, true, 5)), keepLast = false)
        assertEquals(listOf(2), plan)
    }

    @Test
    fun keepLastIgnoresUnreadChapters() {
        val plan = AutoDelete.plan(listOf(ch(1, 1, true, 10), ch(2, 1, false, 99)), keepLast = true)
        assertEquals(emptyList<Int>(), plan)
    }
}
