package dev.fokuroru.reader.ui

import android.os.Bundle
import android.view.inputmethod.EditorInfo
import android.widget.Button
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import dev.fokuroru.reader.Prefs
import dev.fokuroru.reader.R
import dev.fokuroru.reader.Strings
import dev.fokuroru.reader.data.Store
import dev.fokuroru.reader.data.wipe
import dev.fokuroru.reader.widget.ReadingNowWidget
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class SetupActivity : AppCompatActivity() {
    private lateinit var prefs: Prefs
    private lateinit var input: TextInputEditText
    private lateinit var field: TextInputLayout
    private lateinit var connect: Button

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)
        prefs = Prefs(this)

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.setup_root)) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.ime())
            view.setPadding(view.paddingLeft, bars.top, view.paddingRight, bars.bottom)
            insets
        }

        input = findViewById(R.id.setup_input)
        field = findViewById(R.id.setup_field)
        connect = findViewById(R.id.setup_connect)
        input.setText(prefs.serverUrl ?: "")
        connect.setOnClickListener { submit() }
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
            val ok = looksLikeServer(address)
            runOnUiThread {
                connect.isEnabled = true
                connect.setText(R.string.setup_connect)
                if (!ok) {
                    field.error = getString(R.string.setup_error)
                } else {
                    val previous = prefs.serverUrl
                    if (previous != null && previous != address) {
                        Store.get(this).wipe(this)
                        ReadingNowWidget.updateAll(this)
                    }
                    prefs.serverUrl = address
                    setResult(RESULT_OK)
                    finish()
                }
            }
        }
    }

    private fun looksLikeServer(address: String): Boolean = try {
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
