package dev.fokuroru.reader.ui

import android.content.Intent
import android.os.Bundle
import android.view.Menu
import android.view.MenuItem
import android.view.View
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.appbar.MaterialToolbar
import dev.fokuroru.reader.Events
import dev.fokuroru.reader.MainActivity
import dev.fokuroru.reader.R
import dev.fokuroru.reader.data.Download
import dev.fokuroru.reader.data.State
import dev.fokuroru.reader.data.Store
import dev.fokuroru.reader.work.DownloadWorker
import kotlin.concurrent.thread

/** The chapters saved for one series, opened from the grid in [DownloadsActivity]. */
class SeriesDownloadsActivity : AppCompatActivity() {
    private lateinit var store: Store
    private lateinit var adapter: ChapterAdapter
    private lateinit var empty: View
    private lateinit var notice: View
    private var seriesId = 0
    private var title = ""
    private var unsubscribe: (() -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_downloads)
        store = Store.get(this)
        seriesId = intent.getIntExtra(EXTRA_SERIES_ID, 0)
        title = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifEmpty { getString(R.string.downloads_series_unknown) }

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.downloads_root)) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val side = Layouts.sideMarginPx(resources.configuration.screenWidthDp, resources.displayMetrics.density)
            view.setPadding(bars.left + side, bars.top, bars.right + side, bars.bottom)
            insets
        }

        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        toolbar.title = title
        setSupportActionBar(toolbar)
        supportActionBar?.title = title
        toolbar.setNavigationIcon(androidx.appcompat.R.drawable.abc_ic_ab_back_material)
        toolbar.setNavigationOnClickListener { finish() }

        empty = findViewById(R.id.downloads_empty)
        notice = findViewById(R.id.downloads_notice)
        adapter = ChapterAdapter(::open) { row -> thread { remove(row.chapterId) } }
        findViewById<RecyclerView>(R.id.downloads_list).apply {
            layoutManager = LinearLayoutManager(this@SeriesDownloadsActivity)
            adapter = this@SeriesDownloadsActivity.adapter
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

    override fun onCreateOptionsMenu(menu: Menu): Boolean {
        menuInflater.inflate(R.menu.downloads_series, menu)
        return true
    }

    override fun onOptionsItemSelected(item: MenuItem): Boolean {
        if (item.itemId == R.id.action_delete_series) {
            confirmDeleteAll()
            return true
        }
        return super.onOptionsItemSelected(item)
    }

    private fun refresh() {
        thread {
            val rows = store.all().filter { it.seriesId == seriesId }
            runOnUiThread {
                // The last chapter going leaves nothing to show, so go back to the grid.
                if (rows.isEmpty()) {
                    finish()
                    return@runOnUiThread
                }
                adapter.submit(rows)
                empty.visibility = View.GONE
                notice.visibility = if (rows.any { it.state == State.FAILED && it.error == "Signed out" }) View.VISIBLE else View.GONE
            }
        }
    }

    private fun confirmDeleteAll() {
        val count = store.all().count { it.seriesId == seriesId }
        AlertDialog.Builder(this)
            .setTitle(R.string.downloads_series_delete_title)
            .setMessage(resources.getQuantityString(R.plurals.downloads_series_delete_message, count, count, title))
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.downloads_delete) { _, _ ->
                thread { store.all().filter { it.seriesId == seriesId }.forEach { remove(it.chapterId) } }
            }
            .show()
    }

    private fun open(download: Download) {
        if (download.state != State.DONE) return
        startActivity(
            Intent(this, MainActivity::class.java)
                .setAction(MainActivity.ACTION_OPEN)
                .putExtra(MainActivity.EXTRA_PATH, "/read/${download.chapterId}")
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP),
        )
    }

    private fun remove(chapterId: Int) {
        DownloadWorker.cancel(this, chapterId)
        store.delete(chapterId)
        Events.downloadsChanged()
    }

    companion object {
        const val EXTRA_SERIES_ID = "series_id"
        const val EXTRA_TITLE = "title"
    }
}
