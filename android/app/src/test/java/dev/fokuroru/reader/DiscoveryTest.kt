package dev.fokuroru.reader

import dev.fokuroru.reader.net.Discovery
import dev.fokuroru.reader.net.Pairing
import dev.fokuroru.reader.net.PairingLink
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.net.Inet4Address
import java.net.InetAddress

class DiscoveryTest {
    private fun ip(text: String) = InetAddress.getByName(text) as Inet4Address

    @Test
    fun aSlash24HasTwoHundredFiftyThreeNeighbours() {
        val hosts = Discovery.subnetHosts(ip("192.168.1.107"), 24)
        assertEquals(253, hosts.size)
        assertEquals("192.168.1.1", hosts.first())
        assertEquals("192.168.1.254", hosts.last())
        assertEquals(false, "192.168.1.107" in hosts)
    }

    @Test
    fun aHugeNetworkIsCappedAtASlash22() {
        assertEquals(1021, Discovery.subnetHosts(ip("10.0.5.9"), 8).size)
    }

    @Test
    fun onlyAnswersThatLookLikeTheServerCount() {
        assertEquals("0.31.1-fok.80", Discovery.looksLikeMaki("{\"apiRoot\":\"/api/v1\",\"version\":\"0.31.1-fok.80\",\"setupNeeded\":false}"))
        assertNotNull(Discovery.looksLikeMaki("{\"apiRoot\":\"/api/v1\",\"setupNeeded\":false}"))
        assertNull(Discovery.looksLikeMaki("{\"hello\":1}"))
        assertNull(Discovery.looksLikeMaki("<html>"))
    }

    @Test
    fun readsAPairingLink() {
        assertEquals(
            PairingLink("https://comics.example.com", "abc-_123"),
            Pairing.parse("fokuroru://pair?s=https%3A%2F%2Fcomics.example.com&t=abc-_123"),
        )
    }

    @Test
    fun aPlainAddressPairsWithoutACode() {
        assertEquals(PairingLink("http://192.168.1.5:8990", null), Pairing.parse("http://192.168.1.5:8990"))
    }

    @Test
    fun otherCodesAreNotForThisApp() {
        assertNull(Pairing.parse("fokuroru://other?s=http://x"))
        assertNull(Pairing.parse("hello world"))
        assertNull(Pairing.parse(null))
    }
}
