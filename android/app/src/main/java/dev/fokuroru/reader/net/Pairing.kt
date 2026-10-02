package dev.fokuroru.reader.net

import android.content.Context
import dev.fokuroru.reader.Prefs
import dev.fokuroru.reader.Strings
import dev.fokuroru.reader.data.Profiles
import dev.fokuroru.reader.work.ProfileSwitch
import org.json.JSONObject
import java.net.URI
import java.net.URLDecoder

/** What a scanned QR code holds: a server, and when the code came from the web interface a one-time sign-in code. */
data class PairingLink(val server: String, val code: String?)

sealed interface PairResult {
    data object Done : PairResult
    data object Unreachable : PairResult

    /** The server sits behind a sign-in page of its own; the profile exists, so it can be signed in to by hand. */
    data object NeedsGateway : PairResult
    data object Refused : PairResult
}

object Pairing {
    private const val PENDING_CODE = "pending_pair_code"
    private const val PENDING_PROFILE = "pending_pair_profile"
    private const val PENDING_UNTIL = "pending_pair_until"
    private const val CODE_LIFETIME_MS = 290_000L

    private fun clearPending(context: Context) {
        Prefs(context).sp.edit().remove(PENDING_CODE).remove(PENDING_PROFILE).remove(PENDING_UNTIL).apply()
    }

    /**
     * Finishes a pairing that had to wait for a gateway sign-in. Called once the server answers as itself.
     * Blocks. Null when nothing is waiting, otherwise how it went.
     */
    fun completePending(context: Context): PairResult? {
        val sp = Prefs(context).sp
        val code = sp.getString(PENDING_CODE, null) ?: return null
        val profile = sp.getLong(PENDING_PROFILE, -1L)
        if (profile != Profiles.activeId(context)) return null
        if (System.currentTimeMillis() > sp.getLong(PENDING_UNTIL, 0L)) {
            clearPending(context)
            return PairResult.Refused
        }
        val result = exchange(context, code, profile)
        if (result != PairResult.NeedsGateway) clearPending(context)
        return result
    }

    /** `fokuroru://pair?s=<server>&t=<code>`, or a plain server address. Anything else is not for this app. */
    fun parse(text: String?): PairingLink? {
        val raw = text?.trim().orEmpty()
        if (raw.startsWith("fokuroru://")) {
            val uri = try { URI(raw) } catch (_: Exception) { return null }
            if (uri.host != "pair") return null
            val query = uri.rawQuery.orEmpty().split('&').mapNotNull {
                it.split('=', limit = 2).takeIf { parts -> parts.size == 2 }?.let { (k, v) -> k to URLDecoder.decode(v, "UTF-8") }
            }.toMap()
            val server = Strings.normaliseServer(query["s"].orEmpty()) ?: return null
            return PairingLink(server, query["t"]?.takeIf { it.isNotBlank() })
        }
        return Strings.normaliseServer(raw)?.let { PairingLink(it, null) }
    }

    /**
     * Adds the server as a profile, switches to it and, with a code, signs in as the account that made it.
     * Blocks, so call it off the main thread.
     */
    fun pair(context: Context, link: PairingLink): PairResult {
        if (!ServerCheck.isUsable(link.server)) return PairResult.Unreachable
        val existing = Profiles.all(context).firstOrNull { it.url == link.server && it.user == null }
        val profile = existing ?: Profiles.add(context, "", link.server)
        ProfileSwitch.to(context, profile.id)
        if (link.code == null) return PairResult.Done

        return exchange(context, link.code, profile.id)
    }

    /**
     * Trades the code for a session. A server behind a sign-in page of its own refuses the request until the
     * person has passed that page, so the code is kept for [completePending] to use once they have.
     */
    private fun exchange(context: Context, code: String, profileId: Long): PairResult {
        val api = Api(context)
        return try {
            // The first read hands out the antiforgery cookie the exchange has to echo.
            api.getText("/initialize.json")
            val conn = api.checked(api.open("/api/v1/auth/pair", "POST", JSONObject().put("code", code).toString()))
            try {
                conn.inputStream.close()
            } finally {
                conn.disconnect()
            }
            clearPending(context)
            Profiles.snapshotActive(context)
            Profiles.refreshUser(context)
            PairResult.Done
        } catch (_: GatewayException) {
            val sp = Prefs(context).sp
            sp.edit().putString(PENDING_CODE, code).putLong(PENDING_PROFILE, profileId)
                .putLong(PENDING_UNTIL, System.currentTimeMillis() + CODE_LIFETIME_MS).apply()
            PairResult.NeedsGateway
        } catch (_: Exception) {
            PairResult.Refused
        }
    }
}
