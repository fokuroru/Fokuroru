package dev.fokuroru.reader

import dev.fokuroru.reader.net.Versions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class VersionsTest {
    @Test
    fun comparesBuildNumbersNumerically() {
        assertTrue(Versions.compare("0.31.1-fok.65", "0.31.1-fok.67") < 0)
        assertTrue(Versions.compare("0.31.1-fok.100", "0.31.1-fok.67") > 0)
        assertEquals(0, Versions.compare("0.31.1-fok.67", "0.31.1-fok.67"))
        assertTrue(Versions.compare("0.31.2-fok.1", "0.31.1-fok.67") > 0)
    }
}
