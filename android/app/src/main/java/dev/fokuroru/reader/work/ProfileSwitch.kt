package dev.fokuroru.reader.work

import android.content.Context
import androidx.work.WorkManager
import dev.fokuroru.reader.Events
import dev.fokuroru.reader.data.Profiles
import dev.fokuroru.reader.data.State
import dev.fokuroru.reader.data.Store

object ProfileSwitch {
    /** Makes [id] the profile in use. Runs off the main thread: it touches storage and the cookie jar. */
    fun to(context: Context, id: Long) {
        WorkManager.getInstance(context).cancelAllWorkByTag(DownloadWorker.TAG)
        Profiles.activate(context, id)
        val store = Store.get(context)
        store.all().filter { it.state == State.QUEUED || it.state == State.DOWNLOADING }
            .forEach { DownloadWorker.enqueue(context, it.chapterId) }
        if (store.pendingChapterIds().isNotEmpty()) ProgressSync.schedule(context)
        SyncWorker.syncNow(context)
        dev.fokuroru.reader.widget.ReadingNowWidget.updateAll(context)
        Events.downloadsChanged()
    }

    fun delete(context: Context, id: Long) {
        val wasActive = Profiles.activeId(context) == id
        if (wasActive) WorkManager.getInstance(context).cancelAllWorkByTag(DownloadWorker.TAG)
        Profiles.remove(context, id)
        if (wasActive && Profiles.activeId(context) != 0L) to(context, Profiles.activeId(context))
    }
}
