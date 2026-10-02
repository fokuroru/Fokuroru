package dev.fokuroru.reader.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.res.Configuration
import android.os.Bundle

enum class WidgetSize { COMPACT, STANDARD, LARGE }

/** Which layout a widget gets at a given size. Plain numbers so the rules can be tested. */
object WidgetSizes {
    fun classify(widthDp: Int, heightDp: Int): WidgetSize = when {
        heightDp < 100 || widthDp < 150 -> WidgetSize.COMPACT
        heightDp >= 220 && widthDp >= 230 -> WidgetSize.LARGE
        else -> WidgetSize.STANDARD
    }

    /** Columns and rows of covers the shelf widget fits. */
    fun shelfGrid(widthDp: Int, heightDp: Int): Pair<Int, Int> =
        ((widthDp - 24) / 84).coerceIn(2, 6) to ((heightDp - 44) / 120).coerceIn(1, 2)

    /** How many small covers the large reading widget shows along its bottom edge. */
    fun largeShelfCount(widthDp: Int): Int = ((widthDp - 28) / 84).coerceIn(2, 6)

    /** How wide the hero cover can be at this height: two thirds of the height available above the row of small covers. */
    fun heroCoverWidthDp(heightDp: Int): Int = (((heightDp - 28 - 96) * 2) / 3).coerceIn(104, 240)

    /** The title's size in sp: it grows with the widget so a tablet does not get phone-sized text in a big box. */
    fun heroTitleSp(widthDp: Int): Float = when {
        widthDp >= 520 -> 26f
        widthDp >= 380 -> 22f
        else -> 18f
    }

    /**
     * The size the widget is drawn at right now. A launcher reports a portrait box and a landscape box;
     * the one matching the screen's orientation is the one on show.
     */
    fun current(context: Context, options: Bundle): Pair<Int, Int> {
        val portrait = context.resources.configuration.orientation != Configuration.ORIENTATION_LANDSCAPE
        val minW = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH, 180)
        val maxW = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH, minW)
        val minH = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 110)
        val maxH = options.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT, minH)
        return if (portrait) minW to maxH else maxW to minH
    }
}
