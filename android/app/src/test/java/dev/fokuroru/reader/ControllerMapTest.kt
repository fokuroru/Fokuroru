package dev.fokuroru.reader

import android.view.KeyEvent
import dev.fokuroru.reader.input.ControllerMap
import dev.fokuroru.reader.input.PadAction
import org.junit.Assert.assertEquals
import org.junit.Test

class ControllerMapTest {
    @Test
    fun usesDefaultsWhenNothingIsSaved() {
        assertEquals(ControllerMap.defaults, ControllerMap.parse(null))
        assertEquals(ControllerMap.defaults, ControllerMap.parse("not json"))
    }

    @Test
    fun roundTripsAMapping() {
        val map = mapOf(KeyEvent.KEYCODE_BUTTON_A to PadAction.BOOKMARK, 200 to PadAction.NEXT_CHAPTER)
        assertEquals(map, ControllerMap.parse(ControllerMap.toJson(map)))
    }

    @Test
    fun anUnknownActionBecomesNone() {
        assertEquals(PadAction.NONE, ControllerMap.parse("{\"96\":\"fly\"}")[96])
    }

    @Test
    fun anEmptySavedMapStaysEmpty() {
        assertEquals(emptyMap<Int, PadAction>(), ControllerMap.parse("{}"))
    }
}
