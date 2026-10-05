package dev.fokuroru.reader

import dev.fokuroru.reader.data.Download
import dev.fokuroru.reader.data.SavedSeriesGroups
import dev.fokuroru.reader.data.State
import org.junit.Assert.assertEquals
import org.junit.Test

class SavedSeriesTest {
    private fun row(
        chapterId: Int,
        seriesId: Int,
        title: String,
        state: String = State.DONE,
        bytes: Long = 100,
    ) = Download(
        chapterId = chapterId, seriesId = seriesId, seriesTitle = title, label = "Ch $chapterId", pageCount = 10,
        pagesDone = 10, state = state, bytes = bytes, manifest = null, addedAt = 0, readAt = 0, lastPage = 0,
        completed = false, error = null,
    )

    @Test fun `groups chapters by series and counts the saved ones for the badge`() {
        val groups = SavedSeriesGroups.group(
            listOf(row(1, 7, "Solo"), row(2, 7, "Solo"), row(3, 7, "Solo", State.DOWNLOADING), row(4, 9, "Other")),
        )

        assertEquals(listOf(9, 7), groups.map { it.seriesId })
        assertEquals(1, groups[0].saved)
        assertEquals(2, groups[1].saved)
        assertEquals(1, groups[1].pending)
    }

    @Test fun `only saved chapters add to the size and failed ones are counted apart`() {
        val group = SavedSeriesGroups.group(
            listOf(row(1, 7, "Solo", bytes = 300), row(2, 7, "Solo", State.FAILED, bytes = 50), row(3, 7, "Solo", State.QUEUED, bytes = 0)),
        ).single()

        assertEquals(300L, group.bytes)
        assertEquals(1, group.failed)
        assertEquals(1, group.pending)
        assertEquals(1, group.saved)
    }

    @Test fun `series sort by title ignoring case`() {
        val groups = SavedSeriesGroups.group(listOf(row(1, 1, "banana"), row(2, 2, "Apple"), row(3, 3, "cherry")))

        assertEquals(listOf("Apple", "banana", "cherry"), groups.map { it.title })
    }

    @Test fun `a chapter whose series is not known yet sorts last and shows no title`() {
        val groups = SavedSeriesGroups.group(listOf(row(1, 0, "", State.QUEUED), row(2, 5, "Zeta")))

        assertEquals(listOf(5, 0), groups.map { it.seriesId })
        assertEquals("", groups[1].title)
    }

    @Test fun `the title comes from whichever chapter has one`() {
        val group = SavedSeriesGroups.group(listOf(row(1, 7, "", State.QUEUED), row(2, 7, "Solo"))).single()

        assertEquals("Solo", group.title)
    }
}
