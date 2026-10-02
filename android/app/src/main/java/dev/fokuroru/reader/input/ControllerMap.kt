package dev.fokuroru.reader.input

import android.view.KeyEvent
import org.json.JSONObject

/** What a controller button can do while a chapter is open. [js] is what the web reader is told. */
enum class PadAction(val key: String, val js: String?) {
    NONE("none", null),
    NEXT_PAGE("next_page", null),
    PREV_PAGE("prev_page", null),
    NEXT_CHAPTER("next_chapter", "nextChapter"),
    PREV_CHAPTER("prev_chapter", "prevChapter"),
    MENU("menu", "menu"),
    BOOKMARK("bookmark", "bookmark"),
    ZOOM_IN("zoom_in", "zoomIn"),
    ZOOM_OUT("zoom_out", "zoomOut"),
    ZOOM_RESET("zoom_reset", "zoomReset"),
    BRIGHTNESS_UP("brightness_up", null),
    BRIGHTNESS_DOWN("brightness_down", null),
    CLOSE("close", "close");

    companion object {
        fun of(key: String?): PadAction = entries.firstOrNull { it.key == key } ?: NONE
    }
}

/** The buttons a gamepad normally has, in the order the screen lists them. Anything else is added by pressing it. */
val STANDARD_PAD_KEYS = listOf(
    KeyEvent.KEYCODE_BUTTON_A,
    KeyEvent.KEYCODE_BUTTON_B,
    KeyEvent.KEYCODE_BUTTON_X,
    KeyEvent.KEYCODE_BUTTON_Y,
    KeyEvent.KEYCODE_BUTTON_L1,
    KeyEvent.KEYCODE_BUTTON_R1,
    KeyEvent.KEYCODE_BUTTON_L2,
    KeyEvent.KEYCODE_BUTTON_R2,
    KeyEvent.KEYCODE_BUTTON_THUMBL,
    KeyEvent.KEYCODE_BUTTON_THUMBR,
    KeyEvent.KEYCODE_BUTTON_START,
    KeyEvent.KEYCODE_BUTTON_SELECT,
    KeyEvent.KEYCODE_BUTTON_MODE,
    KeyEvent.KEYCODE_DPAD_UP,
    KeyEvent.KEYCODE_DPAD_DOWN,
    KeyEvent.KEYCODE_DPAD_LEFT,
    KeyEvent.KEYCODE_DPAD_RIGHT,
)

/**
 * Button to action, kept as one JSON object of keycode to action key. D-pad directions are unmapped by
 * default: the web reader already turns pages from the arrow keys and knows the reading direction.
 */
object ControllerMap {
    val defaults: Map<Int, PadAction> = mapOf(
        KeyEvent.KEYCODE_BUTTON_R1 to PadAction.NEXT_PAGE,
        KeyEvent.KEYCODE_BUTTON_L1 to PadAction.PREV_PAGE,
        KeyEvent.KEYCODE_BUTTON_A to PadAction.NEXT_PAGE,
        KeyEvent.KEYCODE_BUTTON_B to PadAction.PREV_PAGE,
        KeyEvent.KEYCODE_BUTTON_R2 to PadAction.NEXT_CHAPTER,
        KeyEvent.KEYCODE_BUTTON_L2 to PadAction.PREV_CHAPTER,
        KeyEvent.KEYCODE_BUTTON_X to PadAction.BOOKMARK,
        KeyEvent.KEYCODE_BUTTON_Y to PadAction.MENU,
        KeyEvent.KEYCODE_BUTTON_START to PadAction.MENU,
        KeyEvent.KEYCODE_BUTTON_SELECT to PadAction.CLOSE,
        KeyEvent.KEYCODE_BUTTON_THUMBR to PadAction.ZOOM_IN,
        KeyEvent.KEYCODE_BUTTON_THUMBL to PadAction.ZOOM_OUT,
    )

    fun parse(json: String?): Map<Int, PadAction> {
        if (json.isNullOrBlank()) return defaults
        return try {
            val obj = JSONObject(json)
            obj.keys().asSequence().mapNotNull { code ->
                code.toIntOrNull()?.let { it to PadAction.of(obj.optString(code)) }
            }.toMap()
        } catch (_: Exception) {
            defaults
        }
    }

    fun toJson(map: Map<Int, PadAction>): String =
        JSONObject().apply { map.forEach { (code, action) -> put(code.toString(), action.key) } }.toString()

    fun name(keyCode: Int): String = when (keyCode) {
        KeyEvent.KEYCODE_BUTTON_THUMBL -> "Left stick press"
        KeyEvent.KEYCODE_BUTTON_THUMBR -> "Right stick press"
        KeyEvent.KEYCODE_BUTTON_SELECT -> "Select"
        else -> generic(keyCode)
    }

    private fun generic(keyCode: Int): String = KeyEvent.keyCodeToString(keyCode).removePrefix("KEYCODE_").removePrefix("BUTTON_")
        .replace('_', ' ').lowercase().replaceFirstChar { it.uppercase() }
}
