package dev.fokuroru.reader.ui

import android.Manifest
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.Bundle
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.preference.PreferenceFragmentCompat
import dev.fokuroru.reader.R
import dev.fokuroru.reader.work.SyncWorker

class SettingsActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        supportActionBar?.setDisplayHomeAsUpEnabled(true)
        if (savedInstanceState == null) {
            supportFragmentManager.beginTransaction().replace(android.R.id.content, SettingsFragment()).commit()
        }
    }

    override fun onSupportNavigateUp(): Boolean {
        finish()
        return true
    }

    class SettingsFragment : PreferenceFragmentCompat(), SharedPreferences.OnSharedPreferenceChangeListener {
        private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

        override fun onCreatePreferences(savedInstanceState: Bundle?, rootKey: String?) {
            setPreferencesFromResource(R.xml.preferences, rootKey)
            findPreference<androidx.preference.Preference>("open_downloads")?.setOnPreferenceClickListener {
                startActivity(Intent(requireContext(), DownloadsActivity::class.java))
                true
            }
            findPreference<androidx.preference.Preference>("change_server")?.setOnPreferenceClickListener {
                startActivity(Intent(requireContext(), ServersActivity::class.java))
                true
            }
        }

        override fun onViewCreated(view: android.view.View, savedInstanceState: Bundle?) {
            super.onViewCreated(view, savedInstanceState)
            view.limitContentWidth(resources)
        }

        override fun onResume() {
            super.onResume()
            preferenceManager.sharedPreferences?.registerOnSharedPreferenceChangeListener(this)
        }

        override fun onPause() {
            preferenceManager.sharedPreferences?.unregisterOnSharedPreferenceChangeListener(this)
            super.onPause()
        }

        override fun onSharedPreferenceChanged(prefs: SharedPreferences, key: String?) {
            when (key) {
                "sync_hours" -> SyncWorker.schedule(requireContext())
                "notify_new" -> if (prefs.getBoolean("notify_new", true) && Build.VERSION.SDK_INT >= 33) {
                    notifications.launch(Manifest.permission.POST_NOTIFICATIONS)
                }
            }
        }
    }
}
