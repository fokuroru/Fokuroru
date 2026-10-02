package dev.fokuroru.reader

import android.annotation.SuppressLint
import android.content.Intent
import android.content.res.Configuration
import android.graphics.Bitmap
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import dev.fokuroru.reader.data.ReadingSnapshot
import dev.fokuroru.reader.data.Store
import dev.fokuroru.reader.device.Remote
import dev.fokuroru.reader.input.PageTurnMap
import dev.fokuroru.reader.input.Turn
import dev.fokuroru.reader.net.ServerState
import dev.fokuroru.reader.ui.DownloadsActivity
import dev.fokuroru.reader.ui.ReaderTools
import dev.fokuroru.reader.ui.SettingsActivity
import dev.fokuroru.reader.ui.ServersActivity
import dev.fokuroru.reader.ui.SetupActivity
import dev.fokuroru.reader.data.Profiles
import dev.fokuroru.reader.web.Offline
import dev.fokuroru.reader.web.Routes
import dev.fokuroru.reader.web.WebBridge
import dev.fokuroru.reader.work.ProgressSync
import dev.fokuroru.reader.work.ReadingSync
import dev.fokuroru.reader.work.SyncWorker
import org.json.JSONObject
import kotlin.concurrent.thread

class MainActivity : AppCompatActivity() {
    private lateinit var prefs: Prefs
    private lateinit var web: WebView
    private lateinit var root: View
    private lateinit var offlineView: View
    private lateinit var gatewayBanner: View
    private lateinit var signInBar: View
    private var loginShown = false
    private var loginCheck = 0

    /** Whether the page has a page-turn listener. An older server's web build has none, and then the keys stay the system's. */
    private var webTurn = false
    private lateinit var offline: Offline
    private var remote: Remote? = null
    private var unsubscribe: (() -> Unit)? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var swallowStylus = false
    private var lastShellRefresh = 0L
    private var loadedProfile = -1L

    @Volatile private var currentUrl: String? = null
    private var reading = false
    private var pageFailed = false

    private val setup = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        if (prefs.serverUrl != null) start(intent) else finish()
    }

    private val chooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    private val notifications = registerForActivityResult(ActivityResultContracts.RequestPermission()) {}

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        setContentView(R.layout.activity_main)
        root = findViewById(R.id.root)
        web = findViewById(R.id.web)
        offlineView = findViewById(R.id.offline)
        gatewayBanner = findViewById(R.id.gateway_banner)
        signInBar = findViewById(R.id.signin_bar)
        findViewById<View>(R.id.signin_back).setOnClickListener { startActivity(Intent(this, ServersActivity::class.java)) }
        offline = newOffline()

        ViewCompat.setOnApplyWindowInsetsListener(root) { view, insets ->
            val cutout = if (reading && prefs.cutout) 0 else WindowInsetsCompat.Type.displayCutout()
            val ime = WindowInsetsCompat.Type.ime()
            val i = insets.getInsets(WindowInsetsCompat.Type.systemBars() or cutout or ime)
            view.setPadding(i.left, i.top, i.right, i.bottom)
            WindowInsetsCompat.CONSUMED
        }

        configureWebView()
        wireOverlay()

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                when {
                    offlineView.visibility == View.VISIBLE -> finish()
                    web.canGoBack() -> web.goBack()
                    else -> finish()
                }
            }
        })

        remote = Remote(this, { prefs.turnConfig() }, ::turn)
        askForNotifications()

        if (prefs.serverUrl == null) setup.launch(Intent(this, SetupActivity::class.java)) else start(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (prefs.serverUrl != null) start(intent)
    }

    override fun onStart() {
        super.onStart()
        unsubscribe = Events.onDownloadsChanged {
            web.evaluateJavascript("window.dispatchEvent(new Event('maki-native-downloads'))", null)
        }
    }

    override fun onResume() {
        super.onResume()
        followProfile()
        applyChrome()
        pushLayout()
        if (Store.get(this).pendingChapterIds().isNotEmpty()) ProgressSync.schedule(this)
        if (prefs.serverUrl != null && System.currentTimeMillis() - ReadingSnapshot.load(this).updatedAt > STALE_MS) {
            SyncWorker.syncNow(this)
        }
        checkServer()
        web.onResume()
    }

    override fun onPause() {
        Profiles.snapshotActive(this)
        thread { Profiles.refreshUser(this) }
        remote?.setActive(false)
        CookieManager.getInstance().flush()
        web.onPause()
        super.onPause()
    }

    override fun onStop() {
        unsubscribe?.invoke()
        unsubscribe = null
        super.onStop()
    }

    override fun onDestroy() {
        remote?.release()
        web.destroy()
        super.onDestroy()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        applyChrome()
        pushLayout()
    }

    // ---- web view ----

    @SuppressLint("SetJavaScriptEnabled")
    private fun configureWebView() {
        CookieManager.getInstance().setAcceptCookie(true)
        if (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0) {
            WebView.setWebContentsDebuggingEnabled(true)
        }
        web.setBackgroundColor(getColor(R.color.surface_dark))
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            setSupportMultipleWindows(false)
            userAgentString = "$userAgentString FokuroruAndroid/${BuildConfig.VERSION_NAME}"
        }
        web.addJavascriptInterface(WebBridge(this), "MakiNative")

        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                try {
                    offline.intercept(request)
                } catch (_: Exception) {
                    null
                }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val target = request.url
                val server = Uri.parse(prefs.serverUrl ?: return false)
                if (target.host == server.host && target.port == server.port) return false
                val scheme = target.scheme
                if (scheme != "http" && scheme != "https") {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, target)) }
                    return true
                }
                // Sign-in providers redirect away and back; a tap on an outside link is the only exit.
                if (!offServer() && request.hasGesture() && !request.isRedirect) {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, target)) }
                    return true
                }
                return false
            }

            override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
                pageFailed = false
                currentUrl = url
                routeChanged(url)
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String, isReload: Boolean) {
                currentUrl = url
                routeChanged(url)
            }

            override fun onPageFinished(view: WebView, url: String) {
                if (!pageFailed) offlineView.visibility = View.GONE
                pushLayout()
                if (offServer()) {
                    gatewayBanner.visibility = View.GONE
                } else {
                    offline.signedIn()
                    checkServer()
                    refreshShell()
                }
            }

            override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, response: WebResourceResponse) {
                // A gateway's sign-in page often answers 401 or 403; that page is the thing to show.
                if (!request.isForMainFrame || response.statusCode < 400) return
                if (request.url.host != Uri.parse(prefs.serverUrl ?: return).host) return
                pageFailed = true
                offlineView.visibility = View.VISIBLE
            }

            override fun onReceivedError(view: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
                if (!request.isForMainFrame) return
                pageFailed = true
                offline.forgetReachability()
                offlineView.visibility = View.VISIBLE
            }
        }

        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                fileCallback?.onReceiveValue(null)
                fileCallback = callback
                return try {
                    chooser.launch(params.createIntent())
                    true
                } catch (_: Exception) {
                    fileCallback = null
                    false
                }
            }
        }
    }

    private fun refreshShell() {
        val now = System.currentTimeMillis()
        if (now - lastShellRefresh < SHELL_REFRESH_MS) return
        lastShellRefresh = now
        thread { runCatching { offline.refreshShell() } }
    }

    private fun wireOverlay() {
        findViewById<View>(R.id.gateway_signin).setOnClickListener {
            val base = prefs.serverUrl ?: return@setOnClickListener
            gatewayBanner.visibility = View.GONE
            offline.signInAgain()
            web.loadUrl("$base/")
        }
        findViewById<View>(R.id.offline_retry).setOnClickListener {
            offline.forgetReachability()
            offlineView.visibility = View.GONE
            pageFailed = false
            web.reload()
        }
        findViewById<View>(R.id.offline_downloads).setOnClickListener { openDownloads() }
        findViewById<View>(R.id.offline_change_server).setOnClickListener {
            startActivity(Intent(this, ServersActivity::class.java))
        }
    }

    private fun newOffline() = Offline(this).also { o ->
        o.onState = { runOnUiThread { updateBanner(it) } }
    }

    /** True while a page from another host is showing: a gateway's sign-in, or a provider it sends you to. */
    private fun offServer(): Boolean {
        val server = Uri.parse(prefs.serverUrl ?: return false)
        val page = Uri.parse(currentUrl ?: return false)
        return page.host != null && page.host != server.host
    }

    /** Offers to sign in again when a gateway is in the way and its page is not already up. */
    private fun updateBanner(state: ServerState) {
        gatewayBanner.visibility = if (state == ServerState.GATEWAY && !offServer()) View.VISIBLE else View.GONE
    }

    /**
     * Names the server on any sign-in page, with a way back to the list. A sign-in page cannot say which
     * server it belongs to, and with several saved the person has to be told.
     */
    private fun updateSignInBar() {
        val profile = Profiles.active(this)
        val gateway = offServer()
        val show = profile != null && !reading && (gateway || loginShown)
        signInBar.visibility = if (show) View.VISIBLE else View.GONE
        if (!show || profile == null) return
        findViewById<android.widget.TextView>(R.id.signin_title).text =
            getString(if (gateway) R.string.signin_gateway_title else R.string.signin_title, profile.title())
        findViewById<android.widget.TextView>(R.id.signin_detail).text =
            getString(R.string.signin_detail, profile.url.substringAfter("://"))
    }

    /** Looks for a sign-in form once the page has had time to draw, which works on any server version. */
    private fun scheduleLoginCheck() {
        val round = ++loginCheck
        for (delay in longArrayOf(400, 1500, 3000, 5000, 8000, 12000, 20000, 30000)) {
            web.postDelayed({
                if (round != loginCheck) return@postDelayed
                web.evaluateJavascript(TURN_PROBE) {
                    val now = it == "true"
                    if (now != webTurn) {
                        webTurn = now
                        applyChrome()
                    }
                }
                web.evaluateJavascript(LOGIN_PROBE) { result ->
                    val found = result == "true"
                    if (found != loginShown) {
                        loginShown = found
                        updateSignInBar()
                    }
                }
            }, delay)
        }
    }

    private fun checkServer() {
        thread {
            val state = offline.probeState()
            runOnUiThread { updateBanner(state) }
        }
    }

    /** When another profile was made the one in use, point the web view and the offline layer at it. */
    private fun followProfile() {
        val now = Profiles.activeId(this)
        if (loadedProfile == -1L || now == loadedProfile) return
        val base = prefs.serverUrl
        if (base == null) {
            loadedProfile = -1L
            startActivity(Intent(this, SetupActivity::class.java))
            return
        }
        loadedProfile = now
        offline = newOffline()
        lastShellRefresh = 0L
        offlineView.visibility = View.GONE
        web.clearHistory()
        web.loadUrl("$base/")
    }

    private fun start(intent: Intent?) {
        val base = prefs.serverUrl ?: return
        if (loadedProfile == -1L) loadedProfile = Profiles.activeId(this)
        val action = intent?.action
        intent?.action = null
        if (action == ACTION_CONTINUE || action == ACTION_LATEST) {
            // The saved list can be hours old, so ask the server first and fall back to it when offline.
            thread {
                val fresh = runCatching { ReadingSync.refreshSnapshot(this) }.getOrNull() ?: ReadingSnapshot.load(this)
                runOnUiThread { open(base, action, null, fresh) }
            }
            return
        }
        open(base, action, intent?.getStringExtra(EXTRA_PATH), ReadingSnapshot.EMPTY)
    }

    private fun open(base: String, action: String?, extraPath: String?, snapshot: ReadingSnapshot) {
        val path = when (action) {
            ACTION_OPEN -> extraPath
            ACTION_CONTINUE -> snapshot.continueTarget()?.let { Routes.reader(it.chapterId) }
            ACTION_LATEST -> snapshot.latest?.let { it.chapterId?.let(Routes::reader) ?: "/series/${it.seriesId}" }
            else -> null
        }
        if (path != null) {
            web.loadUrl(base + path)
        } else if (web.url == null) {
            web.loadUrl("$base/")
        }
    }

    fun serverOffline() = offline.knownUnreachable()

    /** True when the page asking is the configured server. */
    fun trusted(): Boolean {
        val server = Uri.parse(prefs.serverUrl ?: return false)
        val page = Uri.parse(currentUrl ?: return false)
        return page.host == server.host && page.port == server.port
    }

    private fun routeChanged(url: String) {
        val parsed = Uri.parse(url)
        val onServer = parsed.host == Uri.parse(prefs.serverUrl ?: return).host
        val now = onServer && Routes.isReader(parsed.path)
        runOnUiThread {
            reading = now
            loginShown = false
            webTurn = false
            applyChrome()
            updateSignInBar()
            scheduleLoginCheck()
        }
    }

    // ---- turning pages ----

    fun turn(direction: Turn) {
        runOnUiThread {
            web.evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('maki-native-turn',{detail:'${direction.js}'}))", null,
            )
        }
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (reading && webTurn) {
            val direction = PageTurnMap.forKey(event.keyCode, prefs.turnConfig())
            if (direction != null) {
                if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) turn(direction)
                return true
            }
        }
        return super.dispatchKeyEvent(event)
    }

    override fun dispatchTouchEvent(ev: MotionEvent): Boolean {
        if (reading && webTurn) {
            when (ev.actionMasked) {
                MotionEvent.ACTION_DOWN -> if (ev.getToolType(0) == MotionEvent.TOOL_TYPE_STYLUS) {
                    PageTurnMap.forStylus(ev.buttonState, prefs.turnConfig())?.let {
                        swallowStylus = true
                        turn(it)
                        return true
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> if (swallowStylus) {
                    swallowStylus = false
                    return true
                }
                else -> if (swallowStylus) return true
            }
        }
        return super.dispatchTouchEvent(ev)
    }

    override fun dispatchGenericMotionEvent(ev: MotionEvent): Boolean {
        if (reading && webTurn && ev.actionMasked == MotionEvent.ACTION_BUTTON_PRESS) {
            PageTurnMap.forStylus(ev.actionButton, prefs.turnConfig())?.let {
                turn(it)
                return true
            }
        }
        return super.dispatchGenericMotionEvent(ev)
    }

    // ---- device ----

    /** Brightness, rotation, bars, cutout and wake lock, all of which only apply while a chapter is open. */
    fun applyChrome() {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        val immersive = reading && prefs.immersive
        if (immersive) {
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
        val night = resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        controller.isAppearanceLightStatusBars = !night
        controller.isAppearanceLightNavigationBars = !night

        val attrs = window.attributes
        attrs.screenBrightness =
            if (reading && prefs.brightnessOverride) prefs.brightness / 100f
            else WindowManager.LayoutParams.BRIGHTNESS_OVERRIDE_NONE
        if (Build.VERSION.SDK_INT >= 28) {
            attrs.layoutInDisplayCutoutMode =
                if (reading && prefs.cutout) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT
        }
        window.attributes = attrs

        if (reading && prefs.keepAwake) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        requestedOrientation = if (reading) prefs.orientation() else android.content.pm.ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        remote?.setActive(reading && webTurn && prefs.remoteButtons)
        ViewCompat.requestApplyInsets(root)
    }

    fun layoutJson(): String {
        val width = resources.configuration.screenWidthDp
        val dual = prefs.dualPage && width >= WIDE_DP
        return JSONObject().put("dual", dual).put("widthDp", width).toString()
    }

    private fun pushLayout() {
        web.evaluateJavascript(
            "window.dispatchEvent(new CustomEvent('maki-native-layout',{detail:${layoutJson()}}))", null,
        )
    }

    fun openSettings() = startActivity(Intent(this, SettingsActivity::class.java))

    fun openDownloads() = startActivity(Intent(this, DownloadsActivity::class.java))

    fun openReaderTools() = ReaderTools.show(this, prefs) {
        applyChrome()
        pushLayout()
    }

    private fun askForNotifications() {
        if (Build.VERSION.SDK_INT < 33 || prefs.sp.getBoolean("asked_notifications", false)) return
        prefs.sp.edit().putBoolean("asked_notifications", true).apply()
        notifications.launch(android.Manifest.permission.POST_NOTIFICATIONS)
    }

    companion object {
        const val ACTION_OPEN = "dev.fokuroru.reader.OPEN"
        const val ACTION_CONTINUE = "dev.fokuroru.reader.CONTINUE"
        const val ACTION_LATEST = "dev.fokuroru.reader.LATEST"
        const val EXTRA_PATH = "path"
        private const val TURN_PROBE = "window.__makiTurn === true"
        private const val LOGIN_PROBE =
            "!!document.querySelector('input[type=password]') && !document.querySelector('.app-navbar, .reader-root, .lite')"
        private const val STALE_MS = 30 * 60 * 1000L
        private const val SHELL_REFRESH_MS = 30 * 60 * 1000L
        private const val WIDE_DP = 600
    }
}
