package dev.fokuroru.reader.widget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.view.View
import android.widget.RemoteViews
import dev.fokuroru.reader.MainActivity
import dev.fokuroru.reader.R
import dev.fokuroru.reader.data.ReadingSnapshot
import dev.fokuroru.reader.work.ReadingSync

class ReadingNowWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { render(context, manager, it) }
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        if (intent.action == ACTION_NEXT) {
            val prefs = context.getSharedPreferences(STATE, Context.MODE_PRIVATE)
            val size = ReadingSnapshot.load(context).items.size.coerceAtLeast(1)
            prefs.edit().putInt(INDEX, (prefs.getInt(INDEX, 0) + 1) % size).apply()
            updateAll(context)
        }
    }

    companion object {
        const val ACTION_NEXT = "dev.fokuroru.reader.WIDGET_NEXT"
        private const val STATE = "widget"
        private const val INDEX = "index"

        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, ReadingNowWidget::class.java))
            ids.forEach { render(context, manager, it) }
        }

        private fun render(context: Context, manager: AppWidgetManager, id: Int) {
            val snapshot = ReadingSnapshot.load(context)
            val views = RemoteViews(context.packageName, R.layout.widget_reading_now)
            val items = snapshot.items
            val index = if (items.isEmpty()) 0 else
                context.getSharedPreferences(STATE, Context.MODE_PRIVATE).getInt(INDEX, 0).coerceIn(0, items.size - 1)
            val item = items.getOrNull(index)

            if (item == null) {
                views.setTextViewText(R.id.widget_title, context.getString(R.string.widget_empty))
                views.setTextViewText(R.id.widget_chapter, "")
                views.setViewVisibility(R.id.widget_progress, View.GONE)
                views.setViewVisibility(R.id.widget_next, View.GONE)
                views.setImageViewResource(R.id.widget_cover, android.R.color.transparent)
                views.setOnClickPendingIntent(R.id.widget_root, open(context, id, null))
            } else {
                views.setTextViewText(R.id.widget_title, item.title)
                val progress = if (item.inProgress && item.pageCount > 0) " · ${item.page + 1}/${item.pageCount}" else ""
                views.setTextViewText(R.id.widget_chapter, item.label + progress)
                if (item.inProgress && item.pageCount > 0) {
                    views.setViewVisibility(R.id.widget_progress, View.VISIBLE)
                    views.setProgressBar(R.id.widget_progress, item.pageCount, (item.page + 1).coerceAtMost(item.pageCount), false)
                } else {
                    views.setViewVisibility(R.id.widget_progress, View.GONE)
                }
                val cover = ReadingSync.scaledCover(ReadingSnapshot.coverFile(context, item.seriesId), 240)
                if (cover != null) views.setImageViewBitmap(R.id.widget_cover, cover)
                else views.setImageViewResource(R.id.widget_cover, android.R.color.transparent)
                views.setViewVisibility(R.id.widget_next, if (items.size > 1) View.VISIBLE else View.GONE)
                views.setOnClickPendingIntent(R.id.widget_root, open(context, id, item.chapterId))
            }

            val next = Intent(context, ReadingNowWidget::class.java).setAction(ACTION_NEXT)
            views.setOnClickPendingIntent(
                R.id.widget_next,
                PendingIntent.getBroadcast(context, id, next, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE),
            )
            manager.updateAppWidget(id, views)
        }

        private fun open(context: Context, widgetId: Int, chapterId: Int?): PendingIntent {
            val intent = Intent(context, MainActivity::class.java)
                .setAction(if (chapterId == null) MainActivity.ACTION_CONTINUE else MainActivity.ACTION_OPEN)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            if (chapterId != null) intent.putExtra(MainActivity.EXTRA_PATH, "/read/$chapterId")
            return PendingIntent.getActivity(
                context, widgetId * 2 + (if (chapterId == null) 0 else 1), intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        }
    }
}
