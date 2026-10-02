package dev.fokuroru.reader.data

import org.json.JSONArray
import org.json.JSONObject

/**
 * A saved place to sign in: one server and one account on it. Two profiles can share a server, which
 * is how a second account is kept alongside the first.
 */
data class Profile(
    val id: Long,
    val name: String,
    val url: String,
    val user: String? = null,
    /** The session cookies as `name=value; name=value`, saved when the profile is left. */
    val cookies: String? = null,
) {
    /** Name shown in lists: what the person called it, else the server's address. */
    fun title(): String = name.ifBlank { url.substringAfter("://") }
}

object ProfileCodec {
    private const val SESSION_COOKIE = "Maki.Session"
    private const val THIRTY_DAYS = 30 * 24 * 60 * 60

    fun encode(profiles: List<Profile>): String = JSONArray(
        profiles.map {
            JSONObject().put("id", it.id).put("name", it.name).put("url", it.url)
                .put("user", it.user ?: JSONObject.NULL).put("cookies", it.cookies ?: JSONObject.NULL)
        },
    ).toString()

    fun decode(text: String?): List<Profile> {
        if (text.isNullOrBlank()) return emptyList()
        return try {
            val array = JSONArray(text)
            (0 until array.length()).map {
                val o = array.getJSONObject(it)
                Profile(
                    o.getLong("id"), o.optString("name"), o.getString("url"),
                    if (o.isNull("user")) null else o.getString("user"),
                    if (o.isNull("cookies")) null else o.getString("cookies"),
                )
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun nextId(profiles: List<Profile>): Long = (profiles.maxOfOrNull { it.id } ?: 0L) + 1

    /** What to activate once [removed] goes: the same one if it was not the active one, else the first left. */
    fun activeAfterRemoving(profiles: List<Profile>, active: Long, removed: Long): Long =
        when {
            removed != active -> active
            else -> profiles.firstOrNull { it.id != removed }?.id ?: 0L
        }

    fun pairs(cookieHeader: String?): List<Pair<String, String>> =
        cookieHeader.orEmpty().split(';').map { it.trim() }.filter { '=' in it }
            .map { it.substringBefore('=') to it.substringAfter('=') }

    /** A `Set-Cookie` line that puts a saved cookie back. The session cookie stays out of reach of scripts. */
    fun restoreLine(name: String, value: String): String =
        "$name=$value; Path=/; Max-Age=$THIRTY_DAYS" + if (name == SESSION_COOKIE) "; HttpOnly" else ""
}
