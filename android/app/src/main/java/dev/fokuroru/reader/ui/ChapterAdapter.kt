package dev.fokuroru.reader.ui

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import dev.fokuroru.reader.R
import dev.fokuroru.reader.Strings
import dev.fokuroru.reader.data.Download
import dev.fokuroru.reader.data.State

/** The saved chapters of one series, one row each, with the state of each and a delete button. */
class ChapterAdapter(
    private val onOpen: (Download) -> Unit,
    private val onDelete: (Download) -> Unit,
) : RecyclerView.Adapter<ChapterAdapter.Holder>() {
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
        // The series is the screen's title, so a row only needs its chapter.
        holder.title.text = row.label.ifEmpty { "Chapter ${row.chapterId}" }
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
