package dev.fokuroru.reader

import dev.fokuroru.reader.widget.WidgetSize
import dev.fokuroru.reader.widget.WidgetSizes
import org.junit.Assert.assertEquals
import org.junit.Test

class WidgetSizesTest {
    @Test
    fun aShortOrNarrowWidgetIsCompact() {
        assertEquals(WidgetSize.COMPACT, WidgetSizes.classify(250, 70))
        assertEquals(WidgetSize.COMPACT, WidgetSizes.classify(110, 200))
    }

    @Test
    fun theDefaultCellsGetTheStandardLayout() {
        assertEquals(WidgetSize.STANDARD, WidgetSizes.classify(180, 110))
        assertEquals(WidgetSize.STANDARD, WidgetSizes.classify(250, 160))
        assertEquals(WidgetSize.STANDARD, WidgetSizes.classify(200, 300))
    }

    @Test
    fun aBigWidgetGetsTheLargeLayout() {
        assertEquals(WidgetSize.LARGE, WidgetSizes.classify(250, 250))
        assertEquals(WidgetSize.LARGE, WidgetSizes.classify(700, 500))
    }

    @Test
    fun theShelfFitsAsManyCoversAsThereIsRoomFor() {
        assertEquals(2 to 1, WidgetSizes.shelfGrid(180, 110))
        assertEquals(4 to 2, WidgetSizes.shelfGrid(400, 300))
        assertEquals(6 to 2, WidgetSizes.shelfGrid(900, 700))
        assertEquals(6 to 2, WidgetSizes.shelfGrid(760, 420))
        assertEquals(2 to 1, WidgetSizes.shelfGrid(100, 60))
        assertEquals(3 to 2, WidgetSizes.shelfGrid(290, 300))
    }

    @Test
    fun theLargeReadingWidgetKeepsBetweenTwoAndFourSmallCovers() {
        assertEquals(2, WidgetSizes.largeShelfCount(230))
        assertEquals(3, WidgetSizes.largeShelfCount(290))
        assertEquals(4, WidgetSizes.largeShelfCount(400))
        assertEquals(6, WidgetSizes.largeShelfCount(700))
    }

    @Test
    fun theHeroCoverGrowsWithTheHeightWithinLimits() {
        assertEquals(104, WidgetSizes.heroCoverWidthDp(220))
        assertEquals(176, WidgetSizes.heroCoverWidthDp(388))
        assertEquals(240, WidgetSizes.heroCoverWidthDp(900))
    }

    @Test
    fun theTitleGrowsWithTheWidth() {
        assertEquals(18f, WidgetSizes.heroTitleSp(300), 0f)
        assertEquals(22f, WidgetSizes.heroTitleSp(420), 0f)
        assertEquals(26f, WidgetSizes.heroTitleSp(700), 0f)
    }
}
