package dev.fokuroru.reader.ui

import android.content.Intent
import android.graphics.Bitmap
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.LruCache
import android.view.LayoutInflater
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.recyclerview.widget.GridLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.card.MaterialCardView
import dev.fokuroru.reader.Events
import dev.fokuroru.reader.R
import dev.fokuroru.reader.data.AutoDelete
import dev.fokuroru.reader.data.Covers
import dev.fokuroru.reader.data.SavedSeries
import dev.fokuroru.reader.data.SavedSeriesGroups
import dev.fokuroru.reader.data.State
import dev.fokuroru.reader.data.Store
import dev.fokuroru.reader.net.Api
import dev.fokuroru.reader.work.DownloadWorker
import dev.fokuroru.reader.work.ReadingSync
import java.util.concurrent.Executors
import kotlin.concurrent.thread

/**
 * What is saved on this device, as a grid of covers like the library, each with the number of saved
 * chapters on a badge. A series opens its own list of chapters ([SeriesDownloadsActivity]); a long press
 * deletes everything saved for it.
 */
class DownloadsActivity : AppCompatActivity() {
    private lateinit var store: Store
    private lateinit var adapter: Adapter
    private lateinit var empty: View
    private lateinit var notice: View
    private var unsubscribe: (() -> Unit)? = null

    /** Covers that could not be fetched this visit, so a dead connection is not retried on every refresh. */
    private val coverAttempts = HashSet<Int>()
    private val covers = Executors.newFixedThreadPool(2)
    private val main = Handler(Looper.getMainLooper())

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_downloads)
        store = Store.get(this)

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.downloads_root)) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val side = Layouts.sideMarginPx(resources.configuration.screenWidthDp, resources.displayMetrics.density, GRID_MAX_DP)
            view.setPadding(bars.left + side, bars.top, bars.right + side, bars.bottom)
            insets
        }

        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        setSupportActionBar(toolbar)
        toolbar.setNavigationIcon(androidx.appcompat.R.drawable.abc_ic_ab_back_material)
        toolbar.setNavigationOnClickListener { finish() }

        empty = findViewById(R.id.downloads_empty)
        notice = findViewById(R.id.downloads_notice)
        adapter = Adapter(this, ::open, ::confirmDelete)
        findViewById<RecyclerView>(R.id.downloads_list).apply {
            layoutManager = GridLayoutManager(this@DownloadsActivity, columns())
            adapter = this@DownloadsActivity.adapter
        }
    }

    override fun onStart() {
        super.onStart()
        unsubscribe = Events.onDownloadsChanged { refresh() }
        refresh()
    }

    override fun onStop() {
        unsubscribe?.invoke()
        super.onStop()
    }

    override fun onDestroy() {
        covers.shutdownNow()
        super.onDestroy()
    }

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.downloads, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == R.id.action_delete_read) {
            thread {
                AutoDelete.plan(store.deletable(), keepLast = false).forEach { remove(it) }
                runOnUiThread { refresh() }
            }
            return true
        }
        return super.onOptionsItemSelected(item)
    }

    /** As many columns as fit at a comfortable cover width, never fewer than two. */
    private fun columns(): Int {
        val widthDp = minOf(resources.configuration.screenWidthDp, GRID_MAX_DP)
        return (widthDp / TILE_DP).coerceIn(2, 6)
    }

    private fun refresh() {
        thread {
            val rows = store.all()
            val series = SavedSeriesGroups.group(rows)
            runOnUiThread {
                adapter.submit(series)
                empty.visibility = if (rows.isEmpty()) View.VISIBLE else View.GONE
                notice.visibility = if (rows.any { it.state == State.FAILED && it.error == "Signed out" }) View.VISIBLE else View.GONE
            }
            fetchMissingCovers(series)
        }
    }

    /** Chapters saved before covers were kept have no art; fetch it once there is a connection. */
    private fun fetchMissingCovers(series: List<SavedSeries>) {
        val missing = series.filter { it.seriesId > 0 && !Covers.file(this, it.seriesId).isFile && coverAttempts.add(it.seriesId) }
        if (missing.isEmpty()) return
        covers.execute {
            val api = Api(applicationContext)
            for (item in missing) {
                if (Covers.ensure(applicationContext, api, item.seriesId)) {
                    main.post { adapter.coverReady(item.seriesId) }
                }
            }
        }
    }

    private fun open(series: SavedSeries) {
        startActivity(
            Intent(this, SeriesDownloadsActivity::class.java)
                .putExtra(SeriesDownloadsActivity.EXTRA_SERIES_ID, series.seriesId)
                .putExtra(SeriesDownloadsActivity.EXTRA_TITLE, series.title),
        )
    }

    private fun confirmDelete(series: SavedSeries) {
        val count = series.saved + series.pending + series.failed
        val name = series.title.ifEmpty { getString(R.string.downloads_series_unknown) }
        AlertDialog.Builder(this)
            .setTitle(R.string.downloads_series_delete_title)
            .setMessage(resources.getQuantityString(R.plurals.downloads_series_delete_message, count, count, name))
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.downloads_delete) { _, _ ->
                thread {
                    store.all().filter { it.seriesId == series.seriesId }.forEach { remove(it.chapterId) }
                    runOnUiThread { refresh() }
                }
            }
            .show()
    }

    private fun remove(chapterId: Int) {
        DownloadWorker.cancel(this, chapterId)
        store.delete(chapterId)
        Events.downloadsChanged()
    }

    private class Adapter(
        private val activity: DownloadsActivity,
        private val onOpen: (SavedSeries) -> Unit,
        private val onLongPress: (SavedSeries) -> Unit,
    ) : RecyclerView.Adapter<Adapter.Holder>() {
        private var rows: List<SavedSeries> = emptyList()
        private val bitmaps = object : LruCache<Int, Bitmap>(CACHED_COVERS) {}
        private val loading = Executors.newFixedThreadPool(2)
        private val main = Handler(Looper.getMainLooper())

        fun submit(next: List<SavedSeries>) {
            rows = next
            notifyDataSetChanged()
        }

        /** A cover that was missing has arrived. */
        fun coverReady(seriesId: Int) {
            bitmaps.remove(seriesId)
            val index = rows.indexOfFirst { it.seriesId == seriesId }
            if (index >= 0) notifyItemChanged(index)
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
            val view = LayoutInflater.from(parent.context).inflate(R.layout.item_series, parent, false)
            val spans = (parent as RecyclerView).layoutManager.let { (it as GridLayoutManager).spanCount }
            val density = parent.resources.displayMetrics.density
            // A 2:3 cover filling the tile, less the tile's own padding.
            val coverWidth = parent.width / spans - (12 * density).toInt()
            view.findViewById<MaterialCardView>(R.id.series_card).layoutParams.height = (coverWidth * 3 / 2).coerceAtLeast(1)
            return Holder(view)
        }

        override fun getItemCount() = rows.size

        override fun onBindViewHolder(holder: Holder, position: Int) {
            val series = rows[position]
            val context = holder.itemView.context
            val name = series.title.ifEmpty { context.getString(R.string.downloads_series_unknown) }
            holder.title.text = name
            holder.initials.text = initials(name)

            holder.badge.visibility = if (series.saved > 0) View.VISIBLE else View.GONE
            holder.badge.text = series.saved.toString()
            holder.badge.contentDescription = context.resources.getQuantityString(R.plurals.downloads_saved_count, series.saved, series.saved)

            val notes = buildList {
                if (series.pending > 0) add(context.getString(R.string.downloads_note_downloading, series.pending))
                if (series.failed > 0) add(context.getString(R.string.downloads_note_failed, series.failed))
            }
            holder.note.visibility = if (notes.isEmpty()) View.GONE else View.VISIBLE
            holder.note.text = notes.joinToString(" · ")

            holder.itemView.setOnClickListener { onOpen(series) }
            holder.itemView.setOnLongClickListener { onLongPress(series); true }
            bindCover(holder, series.seriesId)
        }

        private fun bindCover(holder: Holder, seriesId: Int) {
            holder.cover.tag = seriesId
            holder.cover.setImageDrawable(null)
            bitmaps.get(seriesId)?.let { holder.cover.setImageBitmap(it); return }
            val file = Covers.file(activity, seriesId)
            if (seriesId <= 0 || !file.isFile) return
            loading.execute {
                val bitmap = dev.fokuroru.reader.work.ReadingSync.scaledCover(file, COVER_PX) ?: return@execute
                bitmaps.put(seriesId, bitmap)
                main.post { if (holder.cover.tag == seriesId) holder.cover.setImageBitmap(bitmap) }
            }
        }

        override fun onDetachedFromRecyclerView(recyclerView: RecyclerView) {
            loading.shutdownNow()
        }

        class Holder(view: View) : RecyclerView.ViewHolder(view) {
            val cover: ImageView = view.findViewById(R.id.series_cover)
            val initials: TextView = view.findViewById(R.id.series_initials)
            val badge: TextView = view.findViewById(R.id.series_badge)
            val title: TextView = view.findViewById(R.id.series_title)
            val note: TextView = view.findViewById(R.id.series_note)
        }
    }

    private companion object {
        /** About this wide, and no wider than a phone-and-a-bit, so a tablet gets more columns, not bigger covers. */
        const val TILE_DP = 120
        const val GRID_MAX_DP = 840
        const val CACHED_COVERS = 48
        const val COVER_PX = 360

        fun initials(title: String): String {
            val words = title.replace(Regex("[^\\p{L}\\p{N} ]"), " ").split(' ').filter { it.isNotEmpty() }
            return when {
                words.size > 1 -> "${words[0].first()}${words[1].first()}".uppercase()
                words.size == 1 -> words[0].take(2).uppercase()
                else -> ""
            }
        }
    }
}
