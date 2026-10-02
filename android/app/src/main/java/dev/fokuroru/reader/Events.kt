package dev.fokuroru.reader

import android.os.Handler
import android.os.Looper
import java.util.concurrent.CopyOnWriteArrayList

/** In-process notices the foreground activity forwards to the web page. */
object Events {
    private val downloads = CopyOnWriteArrayList<() -> Unit>()
    private val main = Handler(Looper.getMainLooper())

    fun onDownloadsChanged(listener: () -> Unit): () -> Unit {
        downloads += listener
        return { downloads -= listener }
    }

    fun downloadsChanged() {
        main.post { downloads.forEach { it() } }
    }
}
