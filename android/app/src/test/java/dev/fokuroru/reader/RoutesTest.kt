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
