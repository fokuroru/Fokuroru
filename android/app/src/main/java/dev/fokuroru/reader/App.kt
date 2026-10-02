package dev.fokuroru.reader

import android.app.Application
import dev.fokuroru.reader.work.Notifications
import dev.fokuroru.reader.work.SyncWorker

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
        SyncWorker.schedule(this)
    }
}
