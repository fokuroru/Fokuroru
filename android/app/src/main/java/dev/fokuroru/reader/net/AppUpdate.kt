package dev.fokuroru.reader.net

import android.app.Activity
import android.app.DownloadManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.webkit.CookieManager
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.content.FileProvider
import dev.fokuroru.reader.R
import java.io.File

/** Fetches the newer app from the server the person is signed in to, and hands it to the system installer. */
object AppUpdate {
    private const val FILE = "fokuroru-update.apk"

    fun download(activity: Activity) {
        val base = Api(activity).base
        val target = File(activity.getExternalFilesDir(android.os.Environment.DIRECTORY_DOWNLOADS), FILE).also { it.delete() }
        val request = DownloadManager.Request(Uri.parse("$base/api/v1/android/apk"))
            .setTitle(activity.getString(R.string.update_title))
            .setMimeType("application/vnd.android.package-archive")
            .setDestinationUri(Uri.fromFile(target))
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
        // The server may sit behind a sign-in; the web view's session is what proves who is asking.
        CookieManager.getInstance().getCookie(base)?.let { request.addRequestHeader("Cookie", it) }

        val manager = activity.getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager
        val id = manager.enqueue(request)
        Toast.makeText(activity, R.string.update_downloading, Toast.LENGTH_LONG).show()

        val app = activity.applicationContext
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                if (intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1) != id) return
                app.unregisterReceiver(this)
                val done = manager.query(DownloadManager.Query().setFilterById(id)).use { c ->
                    c.moveToFirst() && c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS)) == DownloadManager.STATUS_SUCCESSFUL
                }
                if (done && target.isFile) install(app, target) else Toast.makeText(app, R.string.update_failed, Toast.LENGTH_LONG).show()
            }
        }
        ContextCompat.registerReceiver(
            app, receiver, IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), ContextCompat.RECEIVER_EXPORTED,
        )
    }

    private fun install(context: Context, file: File) {
        if (Build.VERSION.SDK_INT >= 26 && !context.packageManager.canRequestPackageInstalls()) {
            Toast.makeText(context, R.string.update_allow, Toast.LENGTH_LONG).show()
            context.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            return
        }
        val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", file)
        context.startActivity(
            Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/vnd.android.package-archive")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}
