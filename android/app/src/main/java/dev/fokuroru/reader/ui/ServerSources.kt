package dev.fokuroru.reader.ui

import android.app.Activity
import android.content.Intent
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import dev.fokuroru.reader.MainActivity
import dev.fokuroru.reader.R
import dev.fokuroru.reader.net.Discovery
import dev.fokuroru.reader.net.FoundServer
import dev.fokuroru.reader.net.PairResult
import dev.fokuroru.reader.net.Pairing
import dev.fokuroru.reader.net.PairingLink
import kotlin.concurrent.thread

/** Ways to add a server without typing its address: look on the network, or scan the QR code the web interface shows. */
object ServerSources {
    fun scan(activity: Activity, onLink: (PairingLink) -> Unit) {
        val options = GmsBarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build()
        GmsBarcodeScanning.getClient(activity, options).startScan()
            .addOnSuccessListener { barcode ->
                val link = Pairing.parse(barcode.rawValue)
                if (link == null) Toast.makeText(activity, R.string.pair_not_ours, Toast.LENGTH_LONG).show() else onLink(link)
            }
            .addOnFailureListener {
                Toast.makeText(activity, R.string.pair_scan_failed, Toast.LENGTH_LONG).show()
            }
    }

    fun find(activity: Activity, onPick: (String) -> Unit) {
        val found = java.util.Collections.synchronizedList(mutableListOf<FoundServer>())
        val dialog = MaterialAlertDialogBuilder(activity)
            .setTitle(R.string.discover_title)
            .setMessage(R.string.discover_searching)
            .setNegativeButton(android.R.string.cancel, null)
            .show()
        thread {
            Discovery.scan(activity) { found += it }
            activity.runOnUiThread {
                if (!dialog.isShowing) return@runOnUiThread
                dialog.dismiss()
                val servers = found.sortedBy { it.url }
                if (servers.isEmpty()) {
                    MaterialAlertDialogBuilder(activity)
                        .setTitle(R.string.discover_title)
                        .setMessage(R.string.discover_none)
                        .setPositiveButton(android.R.string.ok, null)
                        .show()
                } else {
                    MaterialAlertDialogBuilder(activity)
                        .setTitle(R.string.discover_pick)
                        .setItems(servers.map { s -> s.url + (s.version?.let { v -> "  ($v)" } ?: "") }.toTypedArray()) { _, which ->
                            onPick(servers[which].url)
                        }
                        .setNegativeButton(android.R.string.cancel, null)
                        .show()
                }
            }
        }
    }

    /** Adds the server from a scanned code, signs in when it carries one, and goes to the app. */
    fun pair(activity: Activity, link: PairingLink, done: () -> Unit = {}) {
        val wait: AlertDialog = MaterialAlertDialogBuilder(activity)
            .setMessage(R.string.pair_working)
            .setCancelable(false)
            .show()
        thread {
            val result = Pairing.pair(activity, link)
            activity.runOnUiThread {
                wait.dismiss()
                when (result) {
                    PairResult.Done, PairResult.NeedsGateway -> {
                        if (result == PairResult.NeedsGateway) {
                            Toast.makeText(activity, R.string.pair_gateway, Toast.LENGTH_LONG).show()
                        }
                        done()
                        activity.startActivity(
                            Intent(activity, MainActivity::class.java)
                                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                        )
                        activity.finish()
                    }
                    PairResult.Unreachable -> Toast.makeText(activity, R.string.setup_error, Toast.LENGTH_LONG).show()
                    PairResult.Refused -> Toast.makeText(activity, R.string.pair_refused, Toast.LENGTH_LONG).show()
                }
            }
        }
    }
}
