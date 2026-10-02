package dev.fokuroru.reader.ui

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.Menu
import android.view.MenuItem
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.appbar.MaterialToolbar
import dev.fokuroru.reader.Events
import dev.fokuroru.reader.MainActivity
import dev.fokuroru.reader.R
import dev.fokuroru.reader.Strings
import dev.fokuroru.reader.data.AutoDelete
import dev.fokuroru.reader.data.Download
import dev.fokuroru.reader.data.State
import dev.fokuroru.reader.data.Store
import dev.fokuroru.reader.work.DownloadWorker
import kotlin.concurrent.thread

class DownloadsActivity : AppCompatActivity() {
    private lateinit var store: Store
    private lateinit var adapter: Adapter
    private lateinit var empty: View
    private lateinit var notice: View
    private var unsubscribe: (() -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_downloads)
        store = Store.get(this)

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.downloads_root)) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        setSupportActionBar(toolbar)
        toolbar.setNavigationIcon(androidx.appcompat.R.drawable.abc_ic_ab_back_material)
        toolbar.setNavigationOnClickListener { finish() }

        empty = findViewById(R.id.downloads_empty)
        notice = findViewById(R.id.downloads_notice)
        adapter = Adapter(::open) { row ->
            thread {
                remove(row.chapterId)
                refresh()
            }
        }
        findViewById<RecyclerView>(R.id.downloads_list).apply {
            layoutManager = LinearLayoutManager(this@DownloadsActivity)
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

    private fun refresh() {
        thread {
            val rows = store.all()
            runOnUiThread {
                adapter.submit(rows)
                empty.visibility = if (rows.isEmpty()) View.VISIBLE else View.GONE
                notice.visibility = if (rows.any { it.state == State.FAILED && it.error == "Signed out" }) View.VISIBLE else View.GONE
            }
        }
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

    private class Adapter(
        private val onOpen: (Download) -> Unit,
        private val onDelete: (Download) -> Unit,
    ) : RecyclerView.Adapter<Adapter.Holder>() {
        private var rows: List<Download> = emptyList()

        fun submit(next: List<Download>) {
            rows = next
            notifyDataSetChanged()
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
            Holder(LayoutInflater.from(parent.context).inflate(R.layout.item_download, parent, false))

        override fun getItemCount() = rows.size

        override fun onBindViewHolder(holder: Holder, position: Int) {
            val row = rows[position]
            val context = holder.itemView.context
            holder.title.text = listOf(row.seriesTitle, row.label).filter { it.isNotEmpty() }.joinToString(" · ")
                .ifEmpty { "Chapter ${row.chapterId}" }
            holder.detail.text = when (row.state) {
                State.DONE -> buildString {
                    append(Strings.bytes(row.bytes))
                    if (row.completed) append(" · read") else if (row.lastPage > 0) append(" · page ${row.lastPage + 1}")
                }
                State.DOWNLOADING -> context.getString(R.string.downloads_state_downloading, row.pagesDone, row.pageCount)
                State.FAILED -> context.getString(R.string.downloads_state_failed)
                else -> context.getString(R.string.downloads_state_queued)
            }
            holder.itemView.setOnClickListener { onOpen(row) }
            holder.delete.setOnClickListener { onDelete(row) }
        }

        class Holder(view: View) : RecyclerView.ViewHolder(view) {
            val title: TextView = view.findViewById(R.id.item_title)
            val detail: TextView = view.findViewById(R.id.item_detail)
            val delete: ImageButton = view.findViewById(R.id.item_delete)
        }
    }
}
