package dev.fokuroru.reader

import dev.fokuroru.reader.data.ReadingItem
import dev.fokuroru.reader.data.ReadingSnapshot
import dev.fokuroru.reader.data.LatestItem
import dev.fokuroru.reader.net.Api
import dev.fokuroru.reader.work.ProgressSync
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class StringsTest {
    @Test
    fun serverAddressesAreNormalised() {
        assertEquals("http://192.168.1.20:8990", Strings.normaliseServer("192.168.1.20:8990"))
        assertEquals("https://maki.example.com", Strings.normaliseServer(" https://maki.example.com/ "))
        assertEquals("http://nas.local/maki", Strings.normaliseServer("nas.local/maki/"))
    }

    @Test
    fun badServerAddressesAreRejected() {
        assertNull(Strings.normaliseServer(""))
        assertNull(Strings.normaliseServer("ftp://host"))
        assertNull(Strings.normaliseServer("http://"))
        assertNull(Strings.normaliseServer("two words"))
    }

    @Test
    fun byteSizes() {
        assertEquals("512 B", Strings.bytes(512))
        assertEquals("2 KB", Strings.bytes(2048))
        assertEquals("1.5 MB", Strings.bytes(1_572_864))
    }

    @Test
    fun antiforgeryTokenIsReadFromTheCookieJar() {
        assertEquals("abc/def==", Api.xsrf("Maki.Session=xyz; XSRF-TOKEN=abc%2Fdef%3D%3D; other=1"))
        assertNull(Api.xsrf("Maki.Session=xyz"))
    }

    @Test
    fun serverTimesParseWithOrWithoutAZone() {
        assertEquals(1_700_000_000_000, ProgressSync.parseTime("2023-11-14T22:13:20Z"))
        assertEquals(1_700_000_000_000, ProgressSync.parseTime("2023-11-14T22:13:20"))
        assertEquals(0, ProgressSync.parseTime("not a date"))
    }

    @Test
    fun readingSnapshotRoundTrips() {
        val snapshot = ReadingSnapshot(
            5,
            listOf(
                ReadingItem(1, "A", "/c.jpg", 10, "Ch.4", 3, 20, 2, true),
                ReadingItem(2, "B", null, 11, "Ch.1", 0, 0, 5, false),
            ),
            LatestItem(3, "C", null, "Ch.9"),
        )
        val parsed = ReadingSnapshot.parse(snapshot.toJson().toString())
        assertEquals(snapshot, parsed)
        assertEquals(10, parsed.continueTarget()?.chapterId)
    }

    @Test
    fun continueFallsBackToTheFirstUpNext() {
        val snapshot = ReadingSnapshot(0, listOf(ReadingItem(2, "B", null, 11, "Ch.1", 0, 0, 5, false)), null)
        assertEquals(11, snapshot.continueTarget()?.chapterId)
        assertNull(ReadingSnapshot.EMPTY.continueTarget())
    }
}

class ShellReferencesTest {
    @Test
    fun entryPageAssets() {
        val html = """<script type="module" crossorigin src="/assets/index-AbC123.js"></script>
            <link rel="stylesheet" crossorigin href="/assets/index-Zx9.css"><link rel="icon" href="/favicon.svg">"""
        assertEquals(
            listOf("/assets/index-AbC123.js", "/assets/index-Zx9.css"),
            dev.fokuroru.reader.web.Shell.references(html, "/"),
        )
    }

    @Test
    fun lazyChunksNamedInsideScripts() {
        val js = """const m=(i,d=["assets/ReaderPage-q1.js","assets/ReaderPage-q2.css"])=>d"""
        assertEquals(
            listOf("/assets/ReaderPage-q1.js", "/assets/ReaderPage-q2.css"),
            dev.fokuroru.reader.web.Shell.references(js, "/assets/index-AbC123.js"),
        )
    }

    @Test
    fun cssFontsResolveAgainstTheStylesheet() {
        val css = """@font-face{src:url(./anton-latin.woff2) format("woff2"),url(data:font/woff2;base64,AAAA)}
            .a{background:url("/assets/tex.png")}"""
        assertEquals(
            listOf("/assets/tex.png", "/assets/anton-latin.woff2"),
            dev.fokuroru.reader.web.Shell.references(css, "/assets/index-Zx9.css").sorted().reversed().sortedBy { it != "/assets/tex.png" },
        )
    }

    @Test
    fun languageCatalogsImportedByRelativePath() {
        val js = """const t={"../locales/de/client.po":()=>import("./client-AbC.js"),"x":()=>import('./client-Zz9.js'),en:()=>s(()=>import(`./client-Bq7.js`),[])}"""
        assertEquals(
            listOf("/assets/client-AbC.js", "/assets/client-Zz9.js", "/assets/client-Bq7.js"),
            dev.fokuroru.reader.web.Shell.references(js, "/assets/index-1.js"),
        )
    }

    @Test
    fun fontSubsetsAreLeftToLoadOnDemand() {
        val css = """a{src:url(./zen-kaku-gothic-new-101-900-normal-BTEuRX46.woff2)}b{src:url(./fira-sans-latin-700-normal-CRhw.woff2),url(./fira-sans-latin-700-normal-CRhw.woff)}"""
        assertEquals(
            listOf("/assets/fira-sans-latin-700-normal-CRhw.woff2"),
            dev.fokuroru.reader.web.Shell.references(css, "/assets/index-Zx9.css"),
        )
    }
}
