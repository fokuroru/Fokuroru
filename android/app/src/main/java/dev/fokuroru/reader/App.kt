package dev.fokuroru.reader

import android.app.Activity
import android.app.Application
import android.os.Bundle
import dev.fokuroru.reader.work.Notifications
import dev.fokuroru.reader.work.SyncWorker

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        Notifications.createChannels(this)
        SyncWorker.schedule(this)
        // MainActivity re-applies its own (reader-aware) orientation right after this in its onResume.
        registerActivityLifecycleCallbacks(object : ActivityLifecycleCallbacks {
            override fun onActivityResumed(activity: Activity) {
                val prefs = Prefs(activity)
                activity.requestedOrientation = prefs.orientation(prefs.appRotation)
            }
            override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
            override fun onActivityStarted(activity: Activity) {}
            override fun onActivityPaused(activity: Activity) {}
            override fun onActivityStopped(activity: Activity) {}
            override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
            override fun onActivityDestroyed(activity: Activity) {}
        })
    }
}
