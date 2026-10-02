package dev.fokuroru.reader.input

import android.view.KeyEvent
import android.view.MotionEvent

enum class Turn(val js: String) {
    NEXT("next"),
    PREVIOUS("prev");

    fun flipped() = if (this == NEXT) PREVIOUS else NEXT
}

data class TurnConfig(
    val volumeKeys: Boolean = true,
    val swapVolumeKeys: Boolean = false,
    val invert: Boolean = false,
    val remoteButtons: Boolean = true,
    val stylusButtons: Boolean = true,
)

/**
 * Maps hardware buttons to page turns. Arrow keys are left alone on purpose: the web reader already
 * handles them and knows the reading direction, which this layer does not.
 */
object PageTurnMap {
    fun forKey(keyCode: Int, config: TurnConfig): Turn? {
        val turn = when (keyCode) {
            KeyEvent.KEYCODE_VOLUME_DOWN -> if (config.volumeKeys) volume(Turn.NEXT, config) else null
            KeyEvent.KEYCODE_VOLUME_UP -> if (config.volumeKeys) volume(Turn.PREVIOUS, config) else null

            KeyEvent.KEYCODE_PAGE_DOWN,
            KeyEvent.KEYCODE_MEDIA_NEXT,
            KeyEvent.KEYCODE_MEDIA_FAST_FORWARD,
            KeyEvent.KEYCODE_NAVIGATE_NEXT,
            KeyEvent.KEYCODE_HEADSETHOOK,
            KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
            KeyEvent.KEYCODE_MEDIA_PLAY,
            KeyEvent.KEYCODE_MEDIA_PAUSE -> if (config.remoteButtons) Turn.NEXT else null

            KeyEvent.KEYCODE_PAGE_UP,
            KeyEvent.KEYCODE_MEDIA_PREVIOUS,
            KeyEvent.KEYCODE_MEDIA_REWIND,
            KeyEvent.KEYCODE_NAVIGATE_PREVIOUS -> if (config.remoteButtons) Turn.PREVIOUS else null

            else -> null
        } ?: return null
        return if (config.invert) turn.flipped() else turn
    }

    fun forStylus(buttonState: Int, config: TurnConfig): Turn? {
        if (!config.stylusButtons) return null
        val turn = when {
            buttonState and MotionEvent.BUTTON_STYLUS_PRIMARY != 0 -> Turn.NEXT
            buttonState and MotionEvent.BUTTON_STYLUS_SECONDARY != 0 -> Turn.PREVIOUS
            else -> return null
        }
        return if (config.invert) turn.flipped() else turn
    }

    private fun volume(base: Turn, config: TurnConfig) = if (config.swapVolumeKeys) base.flipped() else base
}
