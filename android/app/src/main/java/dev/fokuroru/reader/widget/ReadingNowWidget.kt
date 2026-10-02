package dev.fokuroru.reader.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import dev.fokuroru.reader.data.ReadingSnapshot

/** What you are reading, big or small: the layout follows the size the widget is resized to. */
class ReadingNowWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { render(context, manager, it) }
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: Bundle) {
        render(context, manager, id)
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
            ShelfWidget.updateAll(context)
        }

        private fun render(context: Context, manager: AppWidgetManager, id: Int) {
            val (width, height) = WidgetSizes.current(context, manager.getAppWidgetOptions(id))
            val index = context.getSharedPreferences(STATE, Context.MODE_PRIVATE).getInt(INDEX, 0)
            manager.updateAppWidget(id, WidgetViews.reading(context, width, height, ReadingSnapshot.load(context), index, id))
        }
    }
}
