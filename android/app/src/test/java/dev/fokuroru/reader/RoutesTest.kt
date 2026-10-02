package dev.fokuroru.reader

import dev.fokuroru.reader.web.Route
import dev.fokuroru.reader.web.Routes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RoutesTest {
    @Test
    fun pagesAndThumbnails() {
        assertEquals(Route.Page(12, 3), Routes.parse("/api/v1/reader/chapter/12/page/3"))
        assertEquals(Route.Page(12, 0), Routes.parse("/api/v1/reader/chapter/12/thumb/0"))
    }

    @Test
    fun manifestIsOnlyTheBareChapterPath() {
        assertEquals(Route.Manifest(12), Routes.parse("/api/v1/reader/chapter/12"))
        assertNull(Routes.parse("/api/v1/reader/chapter/12/progress"))
    }

    @Test
    fun stashedReads() {
        assertEquals(Route.Stashed, Routes.parse("/initialize.json"))
        assertEquals(Route.Stashed, Routes.parse("/api/v1/auth/me"))
        assertEquals(Route.Stashed, Routes.parse("/api/v1/reader/chapter/4/bookmarks"))
        assertEquals(Route.Stashed, Routes.parse("/api/v1/reader/series/9/progress"))
        assertEquals(Route.Stashed, Routes.parse("/api/v1/reader/tap-zones/app"))
        assertEquals(Route.Stashed, Routes.parse("/api/v1/reader/tap-zones/web"))
    }

    @Test
    fun everythingElsePassesThrough() {
        assertNull(Routes.parse("/api/v1/settings/system"))
        assertNull(Routes.parse("/assets/index-abc.js"))
        assertNull(Routes.parse("/api/v1/auth/login"))
    }

    @Test
    fun readerPaths() {
        assertEquals("/read/42", Routes.reader(42))
        assertTrue(Routes.isReader("/read/42"))
        assertFalse(Routes.isReader("/series/42"))
        assertFalse(Routes.isReader(null))
    }
}

class LayoutsTest {
    @org.junit.Test
    fun phonesAreSinglePage() {
        org.junit.Assert.assertFalse(dev.fokuroru.reader.ui.Layouts.dual(360, 800))
        org.junit.Assert.assertFalse(dev.fokuroru.reader.ui.Layouts.dual(412, 915))
        org.junit.Assert.assertFalse(dev.fokuroru.reader.ui.Layouts.dual(800, 360))
    }

    @org.junit.Test
    fun aTabletUprightKeepsOnePageUntilItIsVeryWide() {
        org.junit.Assert.assertFalse(dev.fokuroru.reader.ui.Layouts.dual(600, 960))
        org.junit.Assert.assertFalse(dev.fokuroru.reader.ui.Layouts.dual(800, 1280))
        org.junit.Assert.assertTrue(dev.fokuroru.reader.ui.Layouts.dual(840, 1280))
        org.junit.Assert.assertTrue(dev.fokuroru.reader.ui.Layouts.dual(1024, 1366))
    }

    @org.junit.Test
    fun aTabletOnItsSideAndAnOpenFoldGetSpreads() {
        org.junit.Assert.assertTrue(dev.fokuroru.reader.ui.Layouts.dual(1280, 800))
        org.junit.Assert.assertTrue(dev.fokuroru.reader.ui.Layouts.dual(700, 720))
        org.junit.Assert.assertTrue(dev.fokuroru.reader.ui.Layouts.dual(840, 700))
    }

    @org.junit.Test
    fun aSmallWindowIsNeverWideEvenIfLandscape() {
        org.junit.Assert.assertFalse(dev.fokuroru.reader.ui.Layouts.dual(480, 320))
        org.junit.Assert.assertFalse(dev.fokuroru.reader.ui.Layouts.dual(599, 400))
    }

    @org.junit.Test
    fun contentStaysWithinItsMaximumWidth() {
        org.junit.Assert.assertEquals(0, dev.fokuroru.reader.ui.Layouts.sideMarginPx(411, 2.75f))
        org.junit.Assert.assertEquals(0, dev.fokuroru.reader.ui.Layouts.sideMarginPx(640, 2f))
        org.junit.Assert.assertEquals(320, dev.fokuroru.reader.ui.Layouts.sideMarginPx(960, 2f))
        org.junit.Assert.assertEquals(240, dev.fokuroru.reader.ui.Layouts.sideMarginPx(960, 3f, 800))
    }
}
