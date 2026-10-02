package dev.fokuroru.reader.widget

import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.os.Bundle
import dev.fokuroru.reader.data.ReadingSnapshot

/** A grid of covers for what you are reading and what is up next, as many as the widget has room for. */
class ShelfWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        ids.forEach { render(context, manager, it) }
    }

    override fun onAppWidgetOptionsChanged(context: Context, manager: AppWidgetManager, id: Int, newOptions: Bundle) {
        render(context, manager, id)
    }

    companion object {
        fun updateAll(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            manager.getAppWidgetIds(ComponentName(context, ShelfWidget::class.java)).forEach { render(context, manager, it) }
        }

        private fun render(context: Context, manager: AppWidgetManager, id: Int) {
            val (width, height) = WidgetSizes.current(context, manager.getAppWidgetOptions(id))
            manager.updateAppWidget(id, WidgetViews.shelf(context, width, height, ReadingSnapshot.load(context), id))
        }
    }
}
