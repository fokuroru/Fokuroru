package dev.fokuroru.reader

import dev.fokuroru.reader.data.Profile
import dev.fokuroru.reader.data.ProfileCodec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ProfileCodecTest {
    private val home = Profile(1, "Home", "http://192.168.1.20:8990", "grum", "Maki.Session=abc; XSRF-TOKEN=x%3D")
    private val second = Profile(2, "", "https://comics.example.com")

    @Test
    fun roundTrips() {
        val decoded = ProfileCodec.decode(ProfileCodec.encode(listOf(home, second)))
        assertEquals(listOf(home, second), decoded)
        assertNull(decoded[1].user)
        assertNull(decoded[1].cookies)
    }

    @Test
    fun garbageDecodesToNothing() {
        assertTrue(ProfileCodec.decode("not json").isEmpty())
        assertTrue(ProfileCodec.decode(null).isEmpty())
        assertTrue(ProfileCodec.decode("").isEmpty())
    }

    @Test
    fun idsNeverRepeatEvenAfterADelete() {
        assertEquals(1L, ProfileCodec.nextId(emptyList()))
        assertEquals(3L, ProfileCodec.nextId(listOf(home, second)))
        assertEquals(3L, ProfileCodec.nextId(listOf(second)))
    }

    @Test
    fun titleFallsBackToTheAddress() {
        assertEquals("Home", home.title())
        assertEquals("comics.example.com", second.title())
    }

    @Test
    fun removingTheActiveProfileHandsOverToAnother() {
        val all = listOf(home, second)
        assertEquals(2L, ProfileCodec.activeAfterRemoving(all, active = 1, removed = 1))
        assertEquals(1L, ProfileCodec.activeAfterRemoving(all, active = 1, removed = 2))
        assertEquals(0L, ProfileCodec.activeAfterRemoving(listOf(home), active = 1, removed = 1))
    }

    @Test
    fun cookieHeadersSplitIntoPairs() {
        val pairs = ProfileCodec.pairs("Maki.Session=abc; XSRF-TOKEN=x%3D; flag")
        assertEquals(listOf("Maki.Session" to "abc", "XSRF-TOKEN" to "x%3D"), pairs)
        assertTrue(ProfileCodec.pairs(null).isEmpty())
    }

    @Test
    fun onlyTheSessionCookieIsRestoredHttpOnly() {
        assertTrue(ProfileCodec.restoreLine("Maki.Session", "abc").endsWith("; HttpOnly"))
        assertTrue(!ProfileCodec.restoreLine("XSRF-TOKEN", "x").contains("HttpOnly"))
        assertTrue(ProfileCodec.restoreLine("XSRF-TOKEN", "x").startsWith("XSRF-TOKEN=x; Path=/"))
    }
}
