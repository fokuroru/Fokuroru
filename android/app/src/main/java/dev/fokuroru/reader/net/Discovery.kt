package dev.fokuroru.reader.net

import android.content.Context
import android.net.ConnectivityManager
import org.json.JSONObject
import java.net.Inet4Address
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

data class FoundServer(val url: String, val version: String?)

/**
 * Looks for Fōkurōru on the networks this device is on. A server is not asked to announce itself (a
 * container on its own network usually cannot), so each address on the local subnet is tried on the ports
 * the server is normally published on, and only something that answers like Fōkurōru is reported.
 */
object Discovery {
    val PORTS = listOf(8990, 8991, 80, 8080)

    fun subnetHosts(address: Inet4Address, prefix: Int): List<String> {
        val bits = prefix.coerceIn(22, 30)
        val ip = address.address.fold(0L) { acc, b -> (acc shl 8) or (b.toLong() and 0xFF) }
        val mask = (0xFFFFFFFFL shl (32 - bits)) and 0xFFFFFFFFL
        val network = ip and mask
        val count = (1L shl (32 - bits)) - 2
        return (1..count).map { network + it }.filter { it != ip }.map {
            "${(it shr 24) and 0xFF}.${(it shr 16) and 0xFF}.${(it shr 8) and 0xFF}.${it and 0xFF}"
        }
    }

    fun looksLikeMaki(body: String): String? = try {
        val json = JSONObject(body)
        if (json.has("apiRoot") && json.has("setupNeeded")) json.optString("version") else null
    } catch (_: Exception) {
        null
    }

    private fun localSubnet(context: Context): Pair<Inet4Address, Int>? {
        val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        val props = cm.getLinkProperties(cm.activeNetwork) ?: return null
        val link = props.linkAddresses.firstOrNull { it.address is Inet4Address } ?: return null
        return (link.address as Inet4Address) to link.prefixLength
    }

    /** Blocks until the scan is done; [onFound] is called from worker threads as servers turn up. */
    fun scan(context: Context, onFound: (FoundServer) -> Unit) {
        val (address, prefix) = localSubnet(context) ?: return
        val pool = Executors.newFixedThreadPool(64)
        for (host in subnetHosts(address, prefix)) {
            for (port in PORTS) {
                pool.execute { probe(host, port)?.let(onFound) }
            }
        }
        pool.shutdown()
        pool.awaitTermination(40, TimeUnit.SECONDS)
    }

    private fun probe(host: String, port: Int): FoundServer? {
        try {
            Socket().use { it.connect(InetSocketAddress(host, port), 350) }
            val base = if (port == 80) "http://$host" else "http://$host:$port"
            val conn = URL("$base/initialize.json").openConnection() as HttpURLConnection
            conn.connectTimeout = 1_500
            conn.readTimeout = 2_000
            conn.instanceFollowRedirects = false
            try {
                if (conn.responseCode != 200) return null
                val version = looksLikeMaki(conn.inputStream.use { String(it.readBytes().take(4096).toByteArray()) }) ?: return null
                return FoundServer(base, version.ifEmpty { null })
            } finally {
                conn.disconnect()
            }
        } catch (_: Exception) {
            return null
        }
    }
}
