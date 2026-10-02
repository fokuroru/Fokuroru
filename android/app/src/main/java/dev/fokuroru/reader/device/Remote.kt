package dev.fokuroru.reader.device

import android.content.Context
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.view.KeyEvent
import android.content.Intent
import dev.fokuroru.reader.input.PageTurnMap
import dev.fokuroru.reader.input.Turn
import dev.fokuroru.reader.input.TurnConfig

/**
 * Headset and Bluetooth media buttons only reach the app that holds an active media session. This
 * holds one, silently, while a chapter is open, and turns the buttons into page turns.
 */
class Remote(context: Context, private val config: () -> TurnConfig, private val turn: (Turn) -> Unit) {
    private val session = MediaSession(context.applicationContext, "fokuroru-reader").apply {
        setCallback(object : MediaSession.Callback() {
            override fun onMediaButtonEvent(mediaButtonIntent: Intent): Boolean {
                val event = mediaButtonIntent.getParcelableExtra<KeyEvent>(Intent.EXTRA_KEY_EVENT) ?: return false
                if (event.action != KeyEvent.ACTION_DOWN || event.repeatCount > 0) return true
                val result = PageTurnMap.forKey(event.keyCode, config()) ?: return super.onMediaButtonEvent(mediaButtonIntent)
                turn(result)
                return true
            }
        })
        setPlaybackState(
            PlaybackState.Builder()
                .setActions(PlaybackState.ACTION_PLAY or PlaybackState.ACTION_PAUSE or PlaybackState.ACTION_PLAY_PAUSE or
                    PlaybackState.ACTION_SKIP_TO_NEXT or PlaybackState.ACTION_SKIP_TO_PREVIOUS)
                .setState(PlaybackState.STATE_PLAYING, 0, 0f)
                .build(),
        )
    }

    fun setActive(active: Boolean) {
        if (session.isActive != active) session.isActive = active
    }

    fun release() {
        session.isActive = false
        session.release()
    }
}
