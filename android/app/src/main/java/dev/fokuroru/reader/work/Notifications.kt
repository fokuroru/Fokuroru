package dev.fokuroru.reader.work

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import dev.fokuroru.reader.MainActivity
import dev.fokuroru.reader.R

object Notifications {
    const val CHANNEL_DOWNLOADS = "downloads"
    const val CHANNEL_UPDATES = "updates"

    fun createChannels(context: Context) {
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_DOWNLOADS, context.getString(R.string.channel_downloads), NotificationManager.IMPORTANCE_LOW),
        )
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL_UPDATES, context.getString(R.string.channel_updates), NotificationManager.IMPORTANCE_DEFAULT),
        )
    }

    fun canPost(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun downloading(context: Context, label: String, done: Int, total: Int) =
        NotificationCompat.Builder(context, CHANNEL_DOWNLOADS)
            .setSmallIcon(R.drawable.ic_stat_book)
            .setContentTitle(context.getString(R.string.notification_downloading, label))
            .setProgress(total.coerceAtLeast(1), done, total == 0)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()

    @SuppressLint("MissingPermission")
    fun newChapters(context: Context, seriesId: Int, title: String, unread: Int, chapterId: Int) {
        if (!canPost(context)) return
        val open = Intent(context, MainActivity::class.java)
            .setAction(MainActivity.ACTION_OPEN)
            .putExtra(MainActivity.EXTRA_PATH, "/read/$chapterId")
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pending = PendingIntent.getActivity(context, seriesId, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL_UPDATES)
            .setSmallIcon(R.drawable.ic_stat_book)
            .setContentTitle(title)
            .setContentText(context.resources.getQuantityString(R.plurals.notification_new_chapters, unread, title, unread))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(seriesId, notification)
        } catch (_: SecurityException) {
        }
    }

    /** At most once a day: sync and downloads stop at a gateway's sign-in and cannot get past it alone. */
    fun signInNeeded(context: Context) {
        if (!canPost(context)) return
        val sp = context.getSharedPreferences("notices", Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        if (now - sp.getLong("sign_in", 0L) < 24 * 60 * 60 * 1000L) return
        sp.edit().putLong("sign_in", now).apply()
        val open = Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        val pending = PendingIntent.getActivity(context, 7001, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(context, CHANNEL_UPDATES)
            .setSmallIcon(R.drawable.ic_stat_book)
            .setContentTitle(context.getString(R.string.notification_signin_title))
            .setContentText(context.getString(R.string.notification_signin_body))
            .setContentIntent(pending)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(7001, notification)
        } catch (_: SecurityException) {
        }
    }
}
