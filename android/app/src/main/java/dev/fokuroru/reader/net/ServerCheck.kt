package dev.fokuroru.reader.net

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object ServerCheck {
    /** True when [address] answers like a Fōkurōru server. Blocks, so call it off the main thread. */
    fun isServer(address: String): Boolean = try {
        val conn = URL("$address/initialize.json").openConnection() as HttpURLConnection
        conn.connectTimeout = 6_000
        conn.readTimeout = 6_000
        try {
            conn.responseCode == 200 && JSONObject(conn.inputStream.bufferedReader().readText()).has("apiRoot")
        } finally {
            conn.disconnect()
        }
    } catch (_: Exception) {
        false
    }
}
