package dev.fokuroru.reader.data

import android.content.Context
import android.webkit.CookieManager
import dev.fokuroru.reader.Prefs
import java.io.File

/**
 * The saved servers and accounts, and which one is in use. Each profile keeps its own files and
 * database under `profiles/<id>`, so a second account, or a second server, never sees the first one's
 * saved chapters or unsent progress. Switching swaps the WebView's cookies, which is all the sign-in is.
 */
object Profiles {
    private const val FILE = "profiles"
    private const val LIST = "list"
    private const val ACTIVE = "active"

    private fun sp(context: Context) = context.applicationContext.getSharedPreferences(FILE, Context.MODE_PRIVATE)

    @Synchronized
    fun all(context: Context): List<Profile> {
        migrateLegacy(context)
        return ProfileCodec.decode(sp(context).getString(LIST, null))
    }

    fun activeId(context: Context): Long {
        all(context)
        return sp(context).getLong(ACTIVE, 0L)
    }

    fun active(context: Context): Profile? = all(context).firstOrNull { it.id == activeId(context) }

    fun dir(context: Context, id: Long): File = File(context.filesDir, "profiles/$id").apply { mkdirs() }

    fun activeDir(context: Context): File = dir(context, activeId(context))

    @Synchronized
    fun add(context: Context, name: String, url: String): Profile {
        val list = all(context)
        val profile = Profile(ProfileCodec.nextId(list), name.trim(), url)
        save(context, list + profile)
        return profile
    }

    @Synchronized
    fun update(context: Context, profile: Profile) {
        save(context, all(context).map { if (it.id == profile.id) profile else it })
    }

    /** The account name the server reported for the profile in use, shown in the list. */
    fun rememberUser(context: Context, user: String) {
        val current = active(context) ?: return
        if (current.user != user) update(context, current.copy(user = user))
    }

    /** Keeps the live sign-in so leaving the profile does not lose it. */
    fun snapshotActive(context: Context) {
        val current = active(context) ?: return
        val cookies = CookieManager.getInstance().getCookie(current.url)
        if (cookies != current.cookies) update(context, current.copy(cookies = cookies))
    }

    @Synchronized
    fun activate(context: Context, id: Long) {
        val list = all(context)
        val target = list.firstOrNull { it.id == id } ?: return
        if (activeId(context) != id) snapshotActive(context)
        val jar = CookieManager.getInstance()
        jar.removeAllCookies(null)
        val saved = all(context).first { it.id == id }
        ProfileCodec.pairs(saved.cookies).forEach { (name, value) -> jar.setCookie(target.url, ProfileCodec.restoreLine(name, value)) }
        jar.flush()
        sp(context).edit().putLong(ACTIVE, id).apply()
    }

    @Synchronized
    fun remove(context: Context, id: Long) {
        val list = all(context)
        val wasActive = activeId(context) == id
        val rest = list.filter { it.id != id }
        save(context, rest)
        Store.forget(context, id)
        dir(context, id).deleteRecursively()
        if (wasActive) {
            CookieManager.getInstance().removeAllCookies(null)
            val next = ProfileCodec.activeAfterRemoving(list, id, id)
            sp(context).edit().putLong(ACTIVE, 0L).apply()
            if (next != 0L) activate(context, next)
        }
    }

    private fun save(context: Context, list: List<Profile>) {
        sp(context).edit().putString(LIST, ProfileCodec.encode(list)).apply()
    }

    /** One server saved before profiles existed becomes the first profile, with its data moved across. */
    private fun migrateLegacy(context: Context) {
        val sp = sp(context)
        if (sp.contains(LIST)) return
        val legacy = Prefs(context).sp.getString(Prefs.SERVER, null)
        if (legacy == null) {
            sp.edit().putString(LIST, ProfileCodec.encode(emptyList())).apply()
            return
        }
        val profile = Profile(1, "", legacy)
        val target = File(context.filesDir, "profiles/1").apply { mkdirs() }
        for (name in listOf("chapters", "stash", "covers", "shell", "reading.json")) {
            val from = File(context.filesDir, name)
            if (from.exists()) from.renameTo(File(target, name))
        }
        for (suffix in listOf("", "-wal", "-shm", "-journal")) {
            val from = context.getDatabasePath("fokuroru.db$suffix")
            if (from.exists()) from.renameTo(context.getDatabasePath("fokuroru-1.db$suffix"))
        }
        sp.edit().putString(LIST, ProfileCodec.encode(listOf(profile))).putLong(ACTIVE, 1L).apply()
        Prefs(context).sp.edit().remove(Prefs.SERVER).apply()
    }
}
