package dev.fokuroru.reader.ui

import android.os.Bundle
import android.view.KeyEvent
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.materialswitch.MaterialSwitch
import dev.fokuroru.reader.Prefs
import dev.fokuroru.reader.R
import dev.fokuroru.reader.input.ControllerMap
import dev.fokuroru.reader.input.PadAction
import dev.fokuroru.reader.input.STANDARD_PAD_KEYS

/** Maps controller buttons to reader actions. A button the list does not know is added by pressing it. */
class ControllerActivity : AppCompatActivity() {
    private lateinit var prefs: Prefs
    private lateinit var rows: LinearLayout
    private lateinit var last: TextView
    private var map: MutableMap<Int, PadAction> = mutableMapOf()
    private var learning: AlertDialog? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_controller)
        prefs = Prefs(this)

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.controller_root)) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val side = Layouts.sideMarginPx(resources.configuration.screenWidthDp, resources.displayMetrics.density)
            view.setPadding(bars.left + side, bars.top, bars.right + side, bars.bottom)
            insets
        }

        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        setSupportActionBar(toolbar)
        toolbar.setNavigationIcon(androidx.appcompat.R.drawable.abc_ic_ab_back_material)
        toolbar.setNavigationOnClickListener { finish() }

        rows = findViewById(R.id.controller_rows)
        last = findViewById(R.id.controller_last)
        findViewById<MaterialSwitch>(R.id.controller_enabled).apply {
            isChecked = prefs.controllerEnabled
            setOnCheckedChangeListener { _, on -> prefs.controllerEnabled = on }
        }
        findViewById<View>(R.id.controller_add).setOnClickListener { learn() }
        findViewById<View>(R.id.controller_reset).setOnClickListener {
            map = ControllerMap.defaults.toMutableMap()
            save()
        }
        map = prefs.controllerMap.toMutableMap()
        render()
    }

    private fun save() {
        prefs.controllerMap = map
        render()
    }

    private fun label(action: PadAction): String = getString(
        when (action) {
            PadAction.NONE -> R.string.pad_none
            PadAction.NEXT_PAGE -> R.string.pad_next_page
            PadAction.PREV_PAGE -> R.string.pad_prev_page
            PadAction.NEXT_CHAPTER -> R.string.pad_next_chapter
            PadAction.PREV_CHAPTER -> R.string.pad_prev_chapter
            PadAction.MENU -> R.string.pad_menu
            PadAction.BOOKMARK -> R.string.pad_bookmark
            PadAction.ZOOM_IN -> R.string.pad_zoom_in
            PadAction.ZOOM_OUT -> R.string.pad_zoom_out
            PadAction.ZOOM_RESET -> R.string.pad_zoom_reset
            PadAction.BRIGHTNESS_UP -> R.string.pad_brightness_up
            PadAction.BRIGHTNESS_DOWN -> R.string.pad_brightness_down
            PadAction.CLOSE -> R.string.pad_close
        },
    )

    private fun render() {
        rows.removeAllViews()
        val codes = (STANDARD_PAD_KEYS + map.keys.filter { it !in STANDARD_PAD_KEYS }.sorted())
        for (code in codes) {
            val row = layoutInflater.inflate(android.R.layout.simple_list_item_2, rows, false)
            row.findViewById<TextView>(android.R.id.text1).text = ControllerMap.name(code)
            row.findViewById<TextView>(android.R.id.text2).text = label(map[code] ?: PadAction.NONE)
            row.setOnClickListener { choose(code) }
            row.setOnLongClickListener {
                if (code !in STANDARD_PAD_KEYS) {
                    map.remove(code)
                    save()
                }
                true
            }
            rows.addView(row)
        }
    }

    private fun choose(code: Int) {
        val actions = PadAction.entries
        AlertDialog.Builder(this)
            .setTitle(ControllerMap.name(code))
            .setSingleChoiceItems(
                actions.map(::label).toTypedArray(),
                actions.indexOf(map[code] ?: PadAction.NONE),
            ) { dialog, which ->
                map[code] = actions[which]
                dialog.dismiss()
                save()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    private fun learn() {
        learning = AlertDialog.Builder(this)
            .setTitle(R.string.controller_press)
            .setMessage(R.string.controller_press_hint)
            .setNegativeButton(android.R.string.cancel, null)
            .setOnDismissListener { learning = null }
            .show()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        val ignored = code == KeyEvent.KEYCODE_BACK || code == KeyEvent.KEYCODE_VOLUME_UP ||
            code == KeyEvent.KEYCODE_VOLUME_DOWN || code == KeyEvent.KEYCODE_POWER
        if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0 && !ignored) {
            val device = event.device?.name ?: getString(R.string.controller_unknown_device)
            last.text = getString(R.string.controller_last, ControllerMap.name(code), device)
            if (learning != null) {
                learning?.dismiss()
                if (code !in map) map[code] = PadAction.NONE
                save()
                choose(code)
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }
}
