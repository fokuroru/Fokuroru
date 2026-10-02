package dev.fokuroru.reader.ui

import android.content.Intent
import android.os.Bundle
import android.view.inputmethod.EditorInfo
import android.widget.Button
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import dev.fokuroru.reader.R
import dev.fokuroru.reader.Strings
import dev.fokuroru.reader.data.Profiles
import dev.fokuroru.reader.net.ServerCheck
import dev.fokuroru.reader.work.ProfileSwitch
import kotlin.concurrent.thread

/** The first-run screen: saves the first server as a profile and makes it the one in use. */
class SetupActivity : AppCompatActivity() {
    private lateinit var input: TextInputEditText
    private lateinit var field: TextInputLayout
    private lateinit var connect: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)

        val base = (32 * resources.displayMetrics.density).toInt()
        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.setup_root)) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            val side = Layouts.sideMarginPx(resources.configuration.screenWidthDp, resources.displayMetrics.density, 480)
            view.setPadding(base + side, bars.top, base + side, bars.bottom)
            insets
        }

        input = findViewById(R.id.setup_input)
        field = findViewById(R.id.setup_field)
        connect = findViewById(R.id.setup_connect)
        connect.setOnClickListener { submit() }
        findViewById<Button>(R.id.setup_scan).setOnClickListener {
            ServerSources.scan(this) { link -> ServerSources.pair(this, link) { setResult(RESULT_OK) } }
        }
        findViewById<Button>(R.id.setup_find).setOnClickListener {
            ServerSources.find(this) { url ->
                input.setText(url)
                submit()
            }
        }
        input.setOnEditorActionListener { _, action, _ ->
            if (action == EditorInfo.IME_ACTION_GO) submit()
            action == EditorInfo.IME_ACTION_GO
        }
    }

    private fun submit() {
        val address = Strings.normaliseServer(input.text?.toString().orEmpty())
        if (address == null) {
            field.error = getString(R.string.setup_error)
            return
        }
        field.error = null
        connect.isEnabled = false
        connect.setText(R.string.setup_checking)
        thread {
            val ok = ServerCheck.isUsable(address)
            if (ok) {
                val existing = Profiles.all(this).firstOrNull { it.url == address && it.user == null }
                ProfileSwitch.to(this, (existing ?: Profiles.add(this, "", address)).id)
            }
            runOnUiThread {
                connect.isEnabled = true
                connect.setText(R.string.setup_connect)
                if (ok) {
                    setResult(RESULT_OK)
                    startActivity(
                        Intent(this, dev.fokuroru.reader.MainActivity::class.java)
                            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    )
                    finish()
                } else {
                    field.error = getString(R.string.setup_error)
                }
            }
        }
    }
}
