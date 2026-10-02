package dev.fokuroru.reader.ui

import android.content.Intent
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageButton
import android.widget.ImageView
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.google.android.material.appbar.MaterialToolbar
import com.google.android.material.dialog.MaterialAlertDialogBuilder
import com.google.android.material.textfield.TextInputEditText
import com.google.android.material.textfield.TextInputLayout
import dev.fokuroru.reader.MainActivity
import dev.fokuroru.reader.R
import dev.fokuroru.reader.Strings
import dev.fokuroru.reader.data.Profile
import dev.fokuroru.reader.data.Profiles
import dev.fokuroru.reader.net.ServerCheck
import dev.fokuroru.reader.work.ProfileSwitch
import kotlin.concurrent.thread

/** The saved servers and the accounts on them: switch between them, add one, or delete one. */
class ServersActivity : AppCompatActivity() {
    private lateinit var adapter: Adapter
    private lateinit var empty: View

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_servers)

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(R.id.servers_root)) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }

        val toolbar = findViewById<MaterialToolbar>(R.id.toolbar)
        setSupportActionBar(toolbar)
        toolbar.setNavigationIcon(androidx.appcompat.R.drawable.abc_ic_ab_back_material)
        toolbar.setNavigationOnClickListener { finish() }

        empty = findViewById(R.id.servers_empty)
        adapter = Adapter(
            onOpen = ::switchTo,
            onAddAccount = { showAddDialog(it.url) },
            onDelete = ::confirmDelete,
        )
        findViewById<RecyclerView>(R.id.servers_list).apply {
            layoutManager = LinearLayoutManager(this@ServersActivity)
            adapter = this@ServersActivity.adapter
        }
        findViewById<View>(R.id.servers_add).setOnClickListener { showAddDialog(null) }
    }

    override fun onStart() {
        super.onStart()
        refresh()
        thread {
            Profiles.refreshUser(this)
            runOnUiThread { refresh() }
        }
    }

    private fun refresh() {
        val rows = Profiles.all(this)
        adapter.submit(rows, Profiles.activeId(this))
        empty.visibility = if (rows.isEmpty()) View.VISIBLE else View.GONE
    }

    private fun switchTo(profile: Profile) {
        if (profile.id == Profiles.activeId(this)) {
            finish()
            return
        }
        thread {
            ProfileSwitch.to(this, profile.id)
            runOnUiThread { backToReader() }
        }
    }

    private fun backToReader() {
        startActivity(
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        finish()
    }

    private fun confirmDelete(profile: Profile) {
        MaterialAlertDialogBuilder(this)
            .setTitle(getString(R.string.servers_delete_title, profile.title()))
            .setMessage(R.string.servers_delete_body)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.downloads_delete) { _, _ ->
                val wasActive = profile.id == Profiles.activeId(this)
                thread {
                    ProfileSwitch.delete(this, profile.id)
                    runOnUiThread {
                        when {
                            Profiles.all(this).isEmpty() -> startActivity(
                                Intent(this, MainActivity::class.java)
                                    .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                            ).also { finish() }
                            wasActive -> backToReader()
                            else -> refresh()
                        }
                    }
                }
            }
            .show()
    }

    /** A new server, or with [url] given, another account on one already saved. */
    private fun showAddDialog(url: String?) {
        val view = LayoutInflater.from(this).inflate(R.layout.dialog_server, null)
        val name = view.findViewById<TextInputEditText>(R.id.dialog_name)
        val address = view.findViewById<TextInputEditText>(R.id.dialog_url)
        val addressField = view.findViewById<TextInputLayout>(R.id.dialog_url_field)
        url?.let { address.setText(it) }

        val dialog = MaterialAlertDialogBuilder(this)
            .setTitle(if (url == null) R.string.servers_add else R.string.servers_add_account)
            .setView(view)
            .setNegativeButton(android.R.string.cancel, null)
            .setPositiveButton(R.string.setup_connect, null)
            .create()
        dialog.setOnShowListener {
            dialog.getButton(android.app.AlertDialog.BUTTON_POSITIVE).setOnClickListener { button ->
                val normalised = Strings.normaliseServer(address.text?.toString().orEmpty())
                val label = name.text?.toString().orEmpty().trim()
                if (normalised == null) {
                    addressField.error = getString(R.string.setup_error)
                    return@setOnClickListener
                }
                if (Profiles.all(this).any { it.url == normalised && it.name.equals(label, ignoreCase = true) }) {
                    addressField.error = getString(R.string.servers_duplicate)
                    return@setOnClickListener
                }
                addressField.error = null
                button.isEnabled = false
                thread {
                    val ok = ServerCheck.isUsable(normalised)
                    if (ok) {
                        val profile = Profiles.add(this, label, normalised)
                        ProfileSwitch.to(this, profile.id)
                    }
                    runOnUiThread {
                        button.isEnabled = true
                        if (ok) {
                            dialog.dismiss()
                            backToReader()
                        } else {
                            addressField.error = getString(R.string.setup_error)
                        }
                    }
                }
            }
        }
        dialog.show()
    }

    private class Adapter(
        private val onOpen: (Profile) -> Unit,
        private val onAddAccount: (Profile) -> Unit,
        private val onDelete: (Profile) -> Unit,
    ) : RecyclerView.Adapter<Adapter.Holder>() {
        private var rows: List<Profile> = emptyList()
        private var active = 0L

        fun submit(next: List<Profile>, activeId: Long) {
            rows = next
            active = activeId
            notifyDataSetChanged()
        }

        override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) =
            Holder(LayoutInflater.from(parent.context).inflate(R.layout.item_server, parent, false))

        override fun getItemCount() = rows.size

        override fun onBindViewHolder(holder: Holder, position: Int) {
            val row = rows[position]
            val context = holder.itemView.context
            holder.title.text = row.title()
            holder.detail.text = (row.user ?: context.getString(R.string.servers_not_signed_in)) + " · " + row.url.substringAfter("://")
            holder.active.visibility = if (row.id == active) View.VISIBLE else View.INVISIBLE
            holder.itemView.setOnClickListener { onOpen(row) }
            holder.addAccount.setOnClickListener { onAddAccount(row) }
            holder.delete.setOnClickListener { onDelete(row) }
        }

        class Holder(view: View) : RecyclerView.ViewHolder(view) {
            val title: TextView = view.findViewById(R.id.server_title)
            val detail: TextView = view.findViewById(R.id.server_detail)
            val active: ImageView = view.findViewById(R.id.server_active)
            val addAccount: ImageButton = view.findViewById(R.id.server_add_account)
            val delete: ImageButton = view.findViewById(R.id.server_delete)
        }
    }
}
