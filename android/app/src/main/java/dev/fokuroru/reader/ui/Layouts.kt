package dev.fokuroru.reader.ui

import android.content.res.Resources
import android.view.View
import kotlin.math.max

/** Window-size rules shared by the screens, kept free of views so they can be tested. */
object Layouts {
    /** Settings, lists and forms stop growing here; a tablet gets margins, not stretched rows. */
    const val CONTENT_MAX_DP = 640

    /** At least this wide, a window can show two pages side by side. */
    const val DUAL_MIN_DP = 600

    /** A tablet this wide shows two pages even held upright. */
    const val DUAL_ALWAYS_DP = 840

    /**
     * Whether the reader should show spreads. Both sides have to be tablet-sized, so a phone on its side
     * stays single-page however wide it is. Held upright, a 10-inch tablet is wide in dp but tall, and
     * two pages there come out smaller than one, so it needs to be very wide or close to square. A fold
     * opened to a nearly square screen counts. Split-screen and resizable windows land here too, since
     * the size is the window's, not the device's.
     */
    fun dual(widthDp: Int, heightDp: Int): Boolean =
        minOf(widthDp, heightDp) >= DUAL_MIN_DP && (widthDp >= DUAL_ALWAYS_DP || widthDp >= heightDp * 0.85)

    /** Extra space to keep each side clear so content stays within [maxDp], 0 on anything narrower. */
    fun sideMarginPx(widthDp: Int, density: Float, maxDp: Int = CONTENT_MAX_DP): Int =
        max(0, ((widthDp - maxDp) * density / 2).toInt())
}

/** Pads [this] sideways so its content is at most [Layouts.CONTENT_MAX_DP] wide, on top of [base] padding. */
fun View.limitContentWidth(resources: Resources, baseLeft: Int = 0, baseRight: Int = 0) {
    val margin = Layouts.sideMarginPx(resources.configuration.screenWidthDp, resources.displayMetrics.density)
    setPadding(baseLeft + margin, paddingTop, baseRight + margin, paddingBottom)
}
