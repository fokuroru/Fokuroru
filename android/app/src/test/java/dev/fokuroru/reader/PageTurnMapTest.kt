package dev.fokuroru.reader

import android.view.KeyEvent
import android.view.MotionEvent
import dev.fokuroru.reader.input.PageTurnMap
import dev.fokuroru.reader.input.Turn
import dev.fokuroru.reader.input.TurnConfig
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PageTurnMapTest {
    private val defaults = TurnConfig()

    @Test
    fun volumeDownGoesForwardAndVolumeUpGoesBack() {
        assertEquals(Turn.NEXT, PageTurnMap.forKey(KeyEvent.KEYCODE_VOLUME_DOWN, defaults))
        assertEquals(Turn.PREVIOUS, PageTurnMap.forKey(KeyEvent.KEYCODE_VOLUME_UP, defaults))
    }

    @Test
    fun swappingVolumeKeysFlipsOnlyTheVolumeKeys() {
        val swapped = defaults.copy(swapVolumeKeys = true)
        assertEquals(Turn.PREVIOUS, PageTurnMap.forKey(KeyEvent.KEYCODE_VOLUME_DOWN, swapped))
        assertEquals(Turn.NEXT, PageTurnMap.forKey(KeyEvent.KEYCODE_VOLUME_UP, swapped))
        assertEquals(Turn.NEXT, PageTurnMap.forKey(KeyEvent.KEYCODE_PAGE_DOWN, swapped))
    }

    @Test
    fun invertFlipsEveryButton() {
        val inverted = defaults.copy(invert = true)
        assertEquals(Turn.PREVIOUS, PageTurnMap.forKey(KeyEvent.KEYCODE_VOLUME_DOWN, inverted))
        assertEquals(Turn.PREVIOUS, PageTurnMap.forKey(KeyEvent.KEYCODE_PAGE_DOWN, inverted))
        assertEquals(Turn.NEXT, PageTurnMap.forKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS, inverted))
    }

    @Test
    fun invertAndSwapCancelOutOnVolume() {
        val both = defaults.copy(invert = true, swapVolumeKeys = true)
        assertEquals(Turn.NEXT, PageTurnMap.forKey(KeyEvent.KEYCODE_VOLUME_DOWN, both))
    }

    @Test
    fun disabledGroupsAreIgnored() {
        assertNull(PageTurnMap.forKey(KeyEvent.KEYCODE_VOLUME_DOWN, defaults.copy(volumeKeys = false)))
        assertNull(PageTurnMap.forKey(KeyEvent.KEYCODE_PAGE_DOWN, defaults.copy(remoteButtons = false)))
        assertNull(PageTurnMap.forKey(KeyEvent.KEYCODE_HEADSETHOOK, defaults.copy(remoteButtons = false)))
    }

    @Test
    fun remotesAndHeadsetsMap() {
        assertEquals(Turn.NEXT, PageTurnMap.forKey(KeyEvent.KEYCODE_HEADSETHOOK, defaults))
        assertEquals(Turn.NEXT, PageTurnMap.forKey(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE, defaults))
        assertEquals(Turn.NEXT, PageTurnMap.forKey(KeyEvent.KEYCODE_MEDIA_NEXT, defaults))
        assertEquals(Turn.PREVIOUS, PageTurnMap.forKey(KeyEvent.KEYCODE_PAGE_UP, defaults))
        assertEquals(Turn.PREVIOUS, PageTurnMap.forKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS, defaults))
    }

    @Test
    fun arrowKeysAreLeftToTheWebReader() {
        assertNull(PageTurnMap.forKey(KeyEvent.KEYCODE_DPAD_LEFT, defaults))
        assertNull(PageTurnMap.forKey(KeyEvent.KEYCODE_DPAD_RIGHT, defaults))
        assertNull(PageTurnMap.forKey(KeyEvent.KEYCODE_SPACE, defaults))
    }

    @Test
    fun stylusButtons() {
        assertEquals(Turn.NEXT, PageTurnMap.forStylus(MotionEvent.BUTTON_STYLUS_PRIMARY, defaults))
        assertEquals(Turn.PREVIOUS, PageTurnMap.forStylus(MotionEvent.BUTTON_STYLUS_SECONDARY, defaults))
        assertNull(PageTurnMap.forStylus(0, defaults))
        assertNull(PageTurnMap.forStylus(MotionEvent.BUTTON_STYLUS_PRIMARY, defaults.copy(stylusButtons = false)))
        assertEquals(Turn.PREVIOUS, PageTurnMap.forStylus(MotionEvent.BUTTON_STYLUS_PRIMARY, defaults.copy(invert = true)))
    }
}
