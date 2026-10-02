package dev.fokuroru.reader.net

import java.net.URI

/** What a request to the server found: Fōkurōru itself, a sign-in page in front of it, or nothing. */
enum class ServerState { OK, GATEWAY, UNREACHABLE }

/**
 * Servers behind a forward-auth gateway (tinyauth, Authelia, Authentik and the like) answer an
 * unauthenticated request with a redirect to the gateway's own login page, or with a 401, instead of
 * with Fōkurōru's JSON. Telling that apart from "no connection" is what lets the app show the
 * gateway's sign-in page and keep queued work, rather than treat it as an offline server.
 */
object Gateway {
    /**
     * Reads the answer to the anonymous `/initialize.json`. Returns null for a redirect that stays on
     * the same host, which the caller follows.
     */
    fun classify(status: Int, contentType: String?, location: String?, serverHost: String?): ServerState? = when {
        status in 200..299 -> if (contentType?.contains("json", ignoreCase = true) == true) ServerState.OK else ServerState.GATEWAY
        status in 300..399 -> if (leavesHost(location, serverHost)) ServerState.GATEWAY else null
        // The endpoint is anonymous in Fōkurōru, so only something in front of it can refuse it.
        status == 401 || status == 403 -> ServerState.GATEWAY
        else -> ServerState.UNREACHABLE
    }

    fun leavesHost(location: String?, serverHost: String?): Boolean {
        if (location.isNullOrBlank()) return true
        val host = try {
            URI(location.trim()).host
        } catch (_: Exception) {
            return true
        }
        return host != null && !host.equals(serverHost, ignoreCase = true)
    }

    fun hostOf(url: String): String? = try {
        URI(url).host
    } catch (_: Exception) {
        null
    }
}
