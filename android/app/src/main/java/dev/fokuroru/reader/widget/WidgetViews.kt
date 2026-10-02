package dev.fokuroru.reader.widget

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import dev.fokuroru.reader.MainActivity
import dev.fokuroru.reader.R
import dev.fokuroru.reader.data.Profiles
import dev.fokuroru.reader.data.ReadingItem
import dev.fokuroru.reader.data.ReadingSnapshot
import dev.fokuroru.reader.work.ReadingSync

/** Builds what the widgets show. Kept apart from the providers so a preview can draw the same views. */
object WidgetViews {
    private const val SHELF_COVER_PX = 120
    private const val HERO_COVER_PX = 300

    private val SHELF_SLOTS = intArrayOf(
        R.id.shelf_slot0, R.id.shelf_slot1, R.id.shelf_slot2, R.id.shelf_slot3, R.id.shelf_slot4, R.id.shelf_slot5,
        R.id.shelf_slot6, R.id.shelf_slot7, R.id.shelf_slot8, R.id.shelf_slot9, R.id.shelf_slot10, R.id.shelf_slot11,
    )
    private val LARGE_SLOTS = intArrayOf(
        R.id.widget_slot0, R.id.widget_slot1, R.id.widget_slot2, R.id.widget_slot3, R.id.widget_slot4, R.id.widget_slot5,
    )

    fun reading(context: Context, widthDp: Int, heightDp: Int, snapshot: ReadingSnapshot, index: Int, widgetId: Int): RemoteViews {
        val size = WidgetSizes.classify(widthDp, heightDp)
        val layout = when (size) {
            WidgetSize.COMPACT -> R.layout.widget_reading_compact
            WidgetSize.STANDARD -> R.layout.widget_reading_now
            WidgetSize.LARGE -> R.layout.widget_reading_large
        }
        val views = RemoteViews(context.packageName, layout)
        val items = snapshot.items
        val current = items.getOrNull(index.coerceIn(0, (items.size - 1).coerceAtLeast(0)))

        if (current == null) {
            val signedOut = Profiles.active(context) == null
            views.setTextViewText(R.id.widget_title, context.getString(if (signedOut) R.string.widget_signed_out else R.string.widget_empty))
            views.setTextViewText(R.id.widget_chapter, "")
            views.setViewVisibility(R.id.widget_progress, View.GONE)
            views.setViewVisibility(R.id.widget_next, View.GONE)
            views.setViewVisibility(R.id.widget_action, View.GONE)
            views.setViewVisibility(R.id.widget_shelf, View.GONE)
            views.setOnClickPendingIntent(R.id.widget_root, open(context, widgetId * 16, null))
            return views
        }

        views.setTextViewText(R.id.widget_title, current.title)
        val started = current.inProgress && current.pageCount > 0
        val progress = if (started) " · ${current.page + 1}/${current.pageCount}" else ""
        views.setTextViewText(R.id.widget_chapter, current.label + progress)
        if (size != WidgetSize.COMPACT) {
            if (started) {
                views.setViewVisibility(R.id.widget_progress, View.VISIBLE)
                views.setProgressBar(R.id.widget_progress, current.pageCount, (current.page + 1).coerceAtMost(current.pageCount), false)
            } else {
                views.setViewVisibility(R.id.widget_progress, View.GONE)
            }
            // Three cells wide is about 180dp: the heading and the next arrow would squeeze the title to a sliver.
            val roomy = widthDp >= 230
            views.setViewVisibility(R.id.widget_next, if (items.size > 1 && roomy) View.VISIBLE else View.GONE)
            views.setViewVisibility(R.id.widget_kicker, if (roomy) View.VISIBLE else View.GONE)
            views.setOnClickPendingIntent(R.id.widget_next, next(context, widgetId))
        }
        cover(context, current, if (size == WidgetSize.LARGE) HERO_COVER_PX else 160)?.let { views.setImageViewBitmap(R.id.widget_cover, it) }
        val open = open(context, widgetId * 16 + 1, current.chapterId)
        views.setOnClickPendingIntent(R.id.widget_root, open)

        if (size == WidgetSize.LARGE) {
            views.setTextViewTextSize(R.id.widget_title, TypedValue.COMPLEX_UNIT_SP, WidgetSizes.heroTitleSp(widthDp))
            // Sizing a view from code needs Android 12; before that the cover keeps its default width.
            if (Build.VERSION.SDK_INT >= 31) {
                views.setViewLayoutWidth(R.id.widget_cover, WidgetSizes.heroCoverWidthDp(heightDp).toFloat(), TypedValue.COMPLEX_UNIT_DIP)
            }
            views.setTextViewText(R.id.widget_action, context.getString(if (started) R.string.widget_resume else R.string.widget_start))
            views.setOnClickPendingIntent(R.id.widget_action, open)
            val others = items.filter { it.seriesId != current.seriesId }.take(WidgetSizes.largeShelfCount(widthDp))
            views.setViewVisibility(R.id.widget_shelf, if (others.isEmpty()) View.GONE else View.VISIBLE)
            LARGE_SLOTS.forEachIndexed { i, slot ->
                val item = others.getOrNull(i)
                if (item == null || i >= WidgetSizes.largeShelfCount(widthDp)) {
                    views.setViewVisibility(slot, if (i < WidgetSizes.largeShelfCount(widthDp)) View.INVISIBLE else View.GONE)
                } else {
                    views.setViewVisibility(slot, View.VISIBLE)
                    fill(context, views, slot, item, widgetId * 16 + 2 + i)
                }
            }
        }
        return views
    }

    fun shelf(context: Context, widthDp: Int, heightDp: Int, snapshot: ReadingSnapshot, widgetId: Int): RemoteViews {
        val views = RemoteViews(context.packageName, R.layout.widget_shelf)
        val (columns, rows) = WidgetSizes.shelfGrid(widthDp, heightDp)
        val items = snapshot.items
        views.setOnClickPendingIntent(R.id.widget_root, open(context, widgetId * 16, items.firstOrNull()?.chapterId))
        views.setViewVisibility(R.id.shelf_empty, if (items.isEmpty()) View.VISIBLE else View.GONE)
        if (items.isEmpty() && Profiles.active(context) == null) {
            views.setTextViewText(R.id.shelf_empty, context.getString(R.string.widget_signed_out))
        }
        views.setViewVisibility(R.id.shelf_row0, if (items.isEmpty()) View.GONE else View.VISIBLE)
        views.setViewVisibility(R.id.shelf_row1, if (rows < 2 || items.isEmpty()) View.GONE else View.VISIBLE)
        SHELF_SLOTS.forEachIndexed { i, slot ->
            val column = i % 6
            val row = i / 6
            val shown = column < columns && row < rows
            val item = items.getOrNull(row * columns + column)
            when {
                !shown -> views.setViewVisibility(slot, View.GONE)
                item == null -> views.setViewVisibility(slot, View.INVISIBLE)
                else -> {
                    views.setViewVisibility(slot, View.VISIBLE)
                    fill(context, views, slot, item, widgetId * 16 + 2 + i)
                }
            }
        }
        return views
    }

    private fun fill(context: Context, views: RemoteViews, slot: Int, item: ReadingItem, requestCode: Int) {
        val bitmap = cover(context, item, SHELF_COVER_PX)
        if (bitmap != null) views.setImageViewBitmap(slot, bitmap) else views.setImageViewResource(slot, android.R.color.transparent)
        views.setContentDescription(slot, item.title + ", " + item.label)
        views.setOnClickPendingIntent(slot, open(context, requestCode, item.chapterId))
    }

    private fun cover(context: Context, item: ReadingItem, maxWidth: Int) =
        ReadingSync.scaledCover(ReadingSnapshot.coverFile(context, item.seriesId), maxWidth)

    private fun open(context: Context, requestCode: Int, chapterId: Int?): PendingIntent {
        val intent = Intent(context, MainActivity::class.java)
            .setAction(if (chapterId == null) MainActivity.ACTION_CONTINUE else MainActivity.ACTION_OPEN)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        if (chapterId != null) intent.putExtra(MainActivity.EXTRA_PATH, "/read/$chapterId")
        return PendingIntent.getActivity(context, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun next(context: Context, widgetId: Int): PendingIntent {
        val intent = Intent(context, ReadingNowWidget::class.java).setAction(ReadingNowWidget.ACTION_NEXT)
        return PendingIntent.getBroadcast(context, widgetId * 16 + 15, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
}
