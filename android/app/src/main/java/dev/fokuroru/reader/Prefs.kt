package dev.fokuroru.reader

import android.content.Context
import android.content.SharedPreferences
import android.content.pm.ActivityInfo
import androidx.preference.PreferenceManager
import dev.fokuroru.reader.input.ControllerMap
import dev.fokuroru.reader.input.PadAction
import dev.fokuroru.reader.input.TurnConfig

class Prefs(context: Context) {
    val sp: SharedPreferences = PreferenceManager.getDefaultSharedPreferences(context.applicationContext)

    private val appContext = context.applicationContext

    /** The server of the profile in use. Profiles own it now, see [dev.fokuroru.reader.data.Profiles]. */
    val serverUrl: String? get() = dev.fokuroru.reader.data.Profiles.active(appContext)?.url

    val volumeKeys get() = sp.getBoolean("volume_keys", true)
    val swapVolumeKeys get() = sp.getBoolean("swap_volume_keys", false)
    var invertTurn: Boolean
        get() = sp.getBoolean("invert_turn", false)
        set(value) = sp.edit().putBoolean("invert_turn", value).apply()
    val remoteButtons get() = sp.getBoolean("remote_buttons", true)
    val stylusButtons get() = sp.getBoolean("stylus_buttons", true)

    var controllerEnabled: Boolean
        get() = sp.getBoolean("controller_enabled", true)
        set(value) = sp.edit().putBoolean("controller_enabled", value).apply()
    var controllerMap: Map<Int, PadAction>
        get() = ControllerMap.parse(sp.getString("controller_map", null))
        set(value) = sp.edit().putString("controller_map", ControllerMap.toJson(value)).apply()

    var keepAwake: Boolean
        get() = sp.getBoolean("keep_awake", true)
        set(value) = sp.edit().putBoolean("keep_awake", value).apply()
    var immersive: Boolean
        get() = sp.getBoolean("immersive", true)
        set(value) = sp.edit().putBoolean("immersive", value).apply()
    val cutout get() = sp.getBoolean("cutout", true)
    var brightnessOverride: Boolean
        get() = sp.getBoolean("brightness_override", false)
        set(value) = sp.edit().putBoolean("brightness_override", value).apply()
    var brightness: Int
        get() = sp.getInt("brightness", 60).coerceIn(1, 100)
        set(value) = sp.edit().putInt("brightness", value.coerceIn(1, 100)).apply()
    var rotation: String
        get() = sp.getString("rotation", "auto") ?: "auto"
        set(value) = sp.edit().putString("rotation", value).apply()
    val dualPage get() = sp.getBoolean("dual_page", true)

    val wifiOnly get() = sp.getBoolean("wifi_only", true)
    val chargingOnly get() = sp.getBoolean("charging_only", false)
    val autoDownloadNext get() = sp.getString("auto_download_next", "0")?.toIntOrNull() ?: 0
    val deleteRead get() = sp.getBoolean("delete_read", false)
    val keepLastRead get() = sp.getBoolean("keep_last_read", true)

    val syncHours get() = sp.getString("sync_hours", "6")?.toIntOrNull() ?: 6
    val notifyNew get() = sp.getBoolean("notify_new", true)

    fun turnConfig() = TurnConfig(
        volumeKeys = volumeKeys,
        swapVolumeKeys = swapVolumeKeys,
        invert = invertTurn,
        remoteButtons = remoteButtons,
        stylusButtons = stylusButtons,
    )

    fun orientation(): Int = when (rotation) {
        "portrait" -> ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT
        "landscape" -> ActivityInfo.SCREEN_ORIENTATION_USER_LANDSCAPE
        "locked" -> ActivityInfo.SCREEN_ORIENTATION_LOCKED
        else -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
    }

    companion object {
        const val SERVER = "server_url"
    }
}
