package dev.fokuroru.reader.net

import java.net.HttpURLConnection
import java.net.URL

object ServerCheck {
    /**
     * What [address] answers: Fōkurōru, a gateway's sign-in page in front of it (which is fine, the
     * next screen is where that gets signed in), or nothing. Blocks, so call it off the main thread.
     */
    fun check(address: String): ServerState {
        val host = Gateway.hostOf(address)
        var target = "$address/initialize.json"
        repeat(3) {
            try {
                val conn = URL(target).openConnection() as HttpURLConnection
                conn.connectTimeout = 6_000
                conn.readTimeout = 6_000
                conn.instanceFollowRedirects = false
                conn.setRequestProperty("Accept", "application/json")
                try {
                    val location = conn.getHeaderField("Location")
                    val state = Gateway.classify(Gateway.status(conn), conn.contentType, location, host)
                    if (state != null) return state
                    if (location == null) return ServerState.UNREACHABLE
                    target = if (location.startsWith("http")) location else address + location
                } finally {
                    conn.disconnect()
                }
            } catch (_: Exception) {
                return ServerState.UNREACHABLE
            }
        }
        return ServerState.UNREACHABLE
    }

    fun isUsable(address: String): Boolean = check(address) != ServerState.UNREACHABLE
}
