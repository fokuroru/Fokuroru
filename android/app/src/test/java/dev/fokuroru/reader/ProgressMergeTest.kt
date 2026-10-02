package dev.fokuroru.reader

import dev.fokuroru.reader.data.ProgressMerge
import dev.fokuroru.reader.data.QueuedProgress
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProgressMergeTest {
    private fun row(id: Long, chapter: Int, page: Int, seconds: Int = 0, completed: Boolean = false, final: Boolean = false, at: Long = id) =
        QueuedProgress(id, chapter, page, completed, seconds, final, at)

    @Test
    fun keepsTheLatestPositionAndSumsTime() {
        val merged = ProgressMerge.merge(listOf(row(1, 7, 2, 30), row(2, 7, 5, 45), row(3, 7, 4, 10)))
        assertEquals(1, merged.size)
        assertEquals(4, merged[0].page)
        assertEquals(85, merged[0].seconds)
        assertEquals(listOf(1L, 2L, 3L), merged[0].ids)
    }

    @Test
    fun completionSticksEvenIfALaterWriteWentBack() {
        val merged = ProgressMerge.merge(listOf(row(1, 7, 19, completed = true), row(2, 7, 3)))
        assertTrue(merged[0].completed)
        assertEquals(3, merged[0].page)
    }

    @Test
    fun separateChaptersStaySeparate() {
        val merged = ProgressMerge.merge(listOf(row(1, 1, 1), row(2, 2, 9), row(3, 1, 4)))
        assertEquals(2, merged.size)
        assertEquals(4, merged.first { it.chapterId == 1 }.page)
        assertEquals(9, merged.first { it.chapterId == 2 }.page)
    }

    @Test
    fun orderComesFromTheTimestampNotTheId() {
        val merged = ProgressMerge.merge(listOf(row(5, 1, 8, at = 100), row(2, 1, 3, at = 200)))
        assertEquals(3, merged[0].page)
    }

    @Test
    fun aVeryLongSittingIsClampedToWhatTheServerAccepts() {
        val merged = ProgressMerge.merge(listOf(row(1, 1, 1, 900), row(2, 1, 2, 900)))
        assertEquals(ProgressMerge.MAX_SECONDS, merged[0].seconds)
    }

    @Test
    fun finalIsSetWhenAnyWriteEndedASitting() {
        assertTrue(ProgressMerge.merge(listOf(row(1, 1, 1), row(2, 1, 2, final = true)))[0].final)
        assertFalse(ProgressMerge.merge(listOf(row(1, 1, 1)))[0].final)
    }
}
