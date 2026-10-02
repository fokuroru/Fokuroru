package dev.fokuroru.reader

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.os.Bundle
import android.util.TypedValue
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import dev.fokuroru.reader.data.ReadingItem
import dev.fokuroru.reader.data.ReadingSnapshot
import dev.fokuroru.reader.widget.WidgetViews
import java.io.File
import java.io.FileOutputStream

/** Debug only. Draws the widgets at the sizes a launcher would give them, with sample covers if there are few. */
class WidgetPreviewActivity : AppCompatActivity() {
    private val sampleIds = mutableListOf<Int>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val empty = intent.getBooleanExtra("empty", false)
        val real = ReadingSnapshot.load(this)
        val snapshot = when {
            empty -> ReadingSnapshot.EMPTY
            real.items.size >= 6 -> real
            else -> sample(real)
        }

        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(12), dp(12), dp(12), dp(24))
        }
        val cases = listOf(
            Triple("reading compact 250x70", 250 to 70, false),
            Triple("reading standard 180x110", 180 to 110, false),
            Triple("reading standard 250x160", 250 to 160, false),
            Triple("reading large 300x280", 300 to 280, false),
            Triple("reading large 420x260", 420 to 260, false),
            Triple("shelf 180x110", 180 to 110, true),
            Triple("shelf 290x200", 290 to 200, true),
            Triple("shelf 400x300", 400 to 300, true),
            Triple("reading large, tablet 700x480", 700 to 480, false),
            Triple("shelf, tablet 760x420", 760 to 420, true),
        )
        cases.forEach { (label, size, shelf) ->
            column.addView(TextView(this).apply { text = label; setPadding(0, dp(14), 0, dp(4)) })
            val frame = FrameLayout(this).apply { layoutParams = ViewGroup.LayoutParams(dp(size.first), dp(size.second)) }
            val views = if (shelf) WidgetViews.shelf(this, size.first, size.second, snapshot, 1)
            else WidgetViews.reading(this, size.first, size.second, snapshot, 0, 1)
            // The application context, not this activity: its inflater would build AppCompat views, which a
            // launcher's widget host never does and which do not accept RemoteViews calls.
            frame.addView(views.apply(applicationContext, frame))
            column.addView(frame)
        }
        setContentView(ScrollView(this).apply { addView(column) })
    }

    override fun onDestroy() {
        sampleIds.forEach { ReadingSnapshot.coverFile(this, it).delete() }
        super.onDestroy()
    }

    private fun dp(value: Int) = TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics).toInt()

    private fun sample(real: ReadingSnapshot): ReadingSnapshot {
        val colours = listOf("#D9503F", "#2F6F9F", "#4E9B5C", "#E0A32B", "#C0508F", "#4B3F9E", "#8A5A3C", "#2D8B8B")
        val names = listOf("Harbour of Lanterns", "The Quiet Orchard", "Salt and Static", "Moonlit Ledger", "Tin Kettle Tales", "Northbound Rails", "Glass Garden", "Paper Cranes at Noon")
        val items = real.items.toMutableList()
        var n = 0
        while (items.size < 12) {
            val id = 9000 + n
            sampleIds += id
            val file = ReadingSnapshot.coverFile(this, id)
            file.parentFile?.mkdirs()
            cover(file, Color.parseColor(colours[n % colours.size]), names[n % names.size])
            items += ReadingItem(id, names[n % names.size], null, 1000 + n, "Ch.${n + 3}", if (n % 2 == 0) 6 else 0, 22, n, n % 2 == 0)
            n++
        }
        return ReadingSnapshot(real.updatedAt, items, real.latest)
    }

    private fun cover(file: File, colour: Int, title: String) {
        val bitmap = Bitmap.createBitmap(240, 360, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(colour)
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; textSize = 26f; strokeWidth = 4f; style = Paint.Style.STROKE }
        canvas.drawCircle(120f, 140f, 80f, paint)
        paint.style = Paint.Style.FILL
        canvas.drawText(title.take(14), 20f, 320f, paint)
        FileOutputStream(file).use { bitmap.compress(Bitmap.CompressFormat.JPEG, 90, it) }
    }
}
