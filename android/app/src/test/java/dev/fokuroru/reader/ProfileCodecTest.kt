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

class GatewayTest {
    private val host = "app.example.com"
    private fun classify(status: Int, type: String? = null, location: String? = null) =
        dev.fokuroru.reader.net.Gateway.classify(status, type, location, host)

    @org.junit.Test
    fun jsonFromTheServerIsTheServer() {
        org.junit.Assert.assertEquals(dev.fokuroru.reader.net.ServerState.OK, classify(200, "application/json; charset=utf-8"))
    }

    @org.junit.Test
    fun aRedirectToAnotherHostIsAGateway() {
        org.junit.Assert.assertEquals(dev.fokuroru.reader.net.ServerState.GATEWAY, classify(302, null, "https://auth.example.com/login?redirect_uri=x"))
        org.junit.Assert.assertEquals(dev.fokuroru.reader.net.ServerState.GATEWAY, classify(307, null, null))
    }

    @org.junit.Test
    fun aRedirectWithinTheServerIsFollowed() {
        org.junit.Assert.assertNull(classify(301, null, "/"))
        org.junit.Assert.assertNull(classify(302, null, "https://APP.example.com/initialize.json"))
    }

    @org.junit.Test
    fun htmlWhereJsonShouldBeIsAGateway() {
        org.junit.Assert.assertEquals(dev.fokuroru.reader.net.ServerState.GATEWAY, classify(200, "text/html"))
        org.junit.Assert.assertEquals(dev.fokuroru.reader.net.ServerState.GATEWAY, classify(200, null))
    }

    @org.junit.Test
    fun refusalsOnTheAnonymousEndpointAreAGateway() {
        org.junit.Assert.assertEquals(dev.fokuroru.reader.net.ServerState.GATEWAY, classify(401))
        org.junit.Assert.assertEquals(dev.fokuroru.reader.net.ServerState.GATEWAY, classify(403))
    }

    @org.junit.Test
    fun errorsAndMissingPagesAreNotAGateway() {
        org.junit.Assert.assertEquals(dev.fokuroru.reader.net.ServerState.UNREACHABLE, classify(404))
        org.junit.Assert.assertEquals(dev.fokuroru.reader.net.ServerState.UNREACHABLE, classify(502))
    }
}

class GatewayLoginUrlTest {
    private fun url(headers: Map<String, String>?) = dev.fokuroru.reader.net.Gateway.loginUrl(headers, "comics.example.com")

    @org.junit.Test
    fun tinyauthNamesItsLoginPageInAHeader() {
        org.junit.Assert.assertEquals(
            "https://tinyauth.example.com/login?login_for=app",
            url(mapOf("X-Tinyauth-Location" to "https://tinyauth.example.com/login?login_for=app")),
        )
    }

    @org.junit.Test
    fun aRedirectHeaderToAnotherHostWorksToo() {
        org.junit.Assert.assertEquals("https://auth.example.com/", url(mapOf("Location" to "https://auth.example.com/")))
    }

    @org.junit.Test
    fun anAddressOnTheServerItselfIsNotAGateway() {
        org.junit.Assert.assertNull(url(mapOf("Location" to "https://comics.example.com/login")))
        org.junit.Assert.assertNull(url(mapOf("Location" to "/login")))
    }

    @org.junit.Test
    fun nothingUsableMeansNoAddress() {
        org.junit.Assert.assertNull(url(null))
        org.junit.Assert.assertNull(url(emptyMap()))
        org.junit.Assert.assertNull(url(mapOf("x-tinyauth-location" to "javascript:alert(1)")))
    }
}
