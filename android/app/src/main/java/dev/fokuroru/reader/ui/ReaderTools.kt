package dev.fokuroru.reader.ui

import android.content.Context
import android.view.View
import android.widget.LinearLayout
import android.widget.TextView
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.button.MaterialButton
import com.google.android.material.button.MaterialButtonToggleGroup
import com.google.android.material.materialswitch.MaterialSwitch
import com.google.android.material.slider.Slider
import dev.fokuroru.reader.Prefs
import dev.fokuroru.reader.R

/** The quick sheet opened from the reader toolbar: the settings people reach for mid-chapter. */
object ReaderTools {
    fun show(context: Context, prefs: Prefs, changed: () -> Unit) {
        val dp = context.resources.displayMetrics.density
        fun px(v: Int) = (v * dp).toInt()

        val column = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(px(24), px(20), px(24), px(28))
        }

        fun label(text: Int) = TextView(context).apply {
            setText(text)
            setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_LabelLarge)
            setPadding(0, px(14), 0, px(4))
        }.also(column::addView)

        fun switch(text: Int, value: Boolean, set: (Boolean) -> Unit) {
            column.addView(
                MaterialSwitch(context).apply {
                    setText(text)
                    isChecked = value
                    setOnCheckedChangeListener { _, on -> set(on); changed() }
                },
            )
        }

        column.addView(
            TextView(context).apply {
                setText(R.string.tools_title)
                setTextAppearance(com.google.android.material.R.style.TextAppearance_Material3_TitleLarge)
            },
        )

        label(R.string.tools_brightness)
        val slider = Slider(context).apply {
            valueFrom = 1f
            valueTo = 100f
            stepSize = 1f
            value = prefs.brightness.toFloat()
            isEnabled = prefs.brightnessOverride
            addOnChangeListener { _, v, fromUser ->
                if (fromUser) {
                    prefs.brightness = v.toInt()
                    changed()
                }
            }
        }
        switch(R.string.tools_brightness_auto, !prefs.brightnessOverride) { auto ->
            prefs.brightnessOverride = !auto
            slider.isEnabled = !auto
        }
        column.addView(slider)

        label(R.string.tools_rotation)
        val group = MaterialButtonToggleGroup(context).apply { isSingleSelection = true; isSelectionRequired = true }
        val modes = listOf(
            "auto" to R.string.tools_rotation_auto,
            "portrait" to R.string.tools_rotation_portrait,
            "landscape" to R.string.tools_rotation_landscape,
            "locked" to R.string.tools_rotation_locked,
        )
        val ids = modes.associate { (mode, text) ->
            val button = MaterialButton(context, null, com.google.android.material.R.attr.materialButtonOutlinedStyle).apply {
                id = View.generateViewId()
                setText(text)
                textSize = 13f
                setPadding(px(6), paddingTop, px(6), paddingBottom)
                maxLines = 1
            }
            group.addView(button)
            button.id to mode
        }
        group.check(ids.entries.first { it.value == prefs.rotation }.key)
        group.addOnButtonCheckedListener { _, id, checked ->
            if (checked) {
                prefs.rotation = ids.getValue(id)
                changed()
            }
        }
        column.addView(group)

        switch(R.string.tools_immersive, prefs.immersive) { prefs.immersive = it }
        switch(R.string.tools_keep_awake, prefs.keepAwake) { prefs.keepAwake = it }
        switch(R.string.tools_invert, prefs.invertTurn) { prefs.invertTurn = it }

        BottomSheetDialog(context).apply {
            setContentView(column)
            show()
        }
    }
}
