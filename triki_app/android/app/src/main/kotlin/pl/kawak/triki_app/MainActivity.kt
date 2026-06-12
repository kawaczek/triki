package pl.kawak.triki_app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Build
import android.provider.Settings
import android.view.KeyEvent
import android.widget.Toast
import androidx.core.app.NotificationCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val CHANNEL = "pl.kawak.triki_app/mouse"
    private val NOTIF_CHANNEL_ID = "triki_status"
    private val NOTIF_ID = 1001

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        createNotificationChannel()

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "isServiceRunning" -> {
                    result.success(TrikiAccessibilityService.instance != null)
                }
                "setCursorOverlayVisible" -> {
                    val visible = call.argument<Boolean>("visible") ?: true
                    TrikiAccessibilityService.isOverlayEnabled = visible
                    val service = TrikiAccessibilityService.instance
                    if (service != null) {
                        service.setCursorOverlayVisible(visible)
                        result.success(true)
                    } else {
                        result.success(false)
                    }
                }
                "moveCursor" -> {
                    val dx = call.argument<Double>("dx")?.toFloat() ?: 0f
                    val dy = call.argument<Double>("dy")?.toFloat() ?: 0f
                    val service = TrikiAccessibilityService.instance
                    if (service != null) {
                        service.moveCursor(dx, dy)
                        result.success(true)
                    } else {
                        result.error("SERVICE_NOT_RUNNING", "Accessibility service is not running", null)
                    }
                }
                "click" -> {
                    TrikiAccessibilityService.instance?.performClick()
                    result.success(true)
                }
                "rightClick" -> {
                    TrikiAccessibilityService.instance?.performRightClick()
                    result.success(true)
                }
                "doubleClick" -> {
                    TrikiAccessibilityService.instance?.performDoubleClick()
                    result.success(true)
                }
                "scroll" -> {
                    val dx = call.argument<Double>("dx")?.toFloat() ?: 0f
                    val dy = call.argument<Double>("dy")?.toFloat() ?: 0f
                    TrikiAccessibilityService.instance?.performScroll(dx, dy)
                    result.success(true)
                }
                "openAccessibilitySettings" -> {
                    val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    startActivity(intent)
                    result.success(true)
                }
                "showNotification" -> {
                    val title = call.argument<String>("title") ?: "Triki-myszka"
                    val body  = call.argument<String>("body")  ?: ""
                    showStatusNotification(title, body)
                    result.success(true)
                }
                "hideNotification" -> {
                    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                    nm.cancel(NOTIF_ID)
                    result.success(true)
                }
                "showToast" -> {
                    val message = call.argument<String>("message") ?: ""
                    Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
                    result.success(true)
                }
                "volumeUp" -> {
                    val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
                    audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_RAISE, AudioManager.FLAG_SHOW_UI)
                    result.success(true)
                }
                "volumeDown" -> {
                    val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
                    audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_LOWER, AudioManager.FLAG_SHOW_UI)
                    result.success(true)
                }
                "mediaPlayPause" -> {
                    val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
                    audioManager.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
                    audioManager.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE))
                    result.success(true)
                }
                "mediaNext" -> {
                    val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
                    audioManager.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_NEXT))
                    audioManager.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_NEXT))
                    result.success(true)
                }
                "mediaPrev" -> {
                    val audioManager = getSystemService(Context.AUDIO_SERVICE) as AudioManager
                    audioManager.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, KeyEvent.KEYCODE_MEDIA_PREVIOUS))
                    audioManager.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, KeyEvent.KEYCODE_MEDIA_PREVIOUS))
                    result.success(true)
                }
                "socialSwipe" -> {
                    val direction = call.argument<String>("direction") ?: "UP"
                    val service = TrikiAccessibilityService.instance
                    if (service != null) {
                        service.performSwipe(direction)
                        result.success(true)
                    } else {
                        result.error("SERVICE_NOT_RUNNING", "Accessibility service is not running", null)
                    }
                }
                "socialDoubleTap" -> {
                    val service = TrikiAccessibilityService.instance
                    if (service != null) {
                        service.performDoubleTapAtCenter()
                        result.success(true)
                    } else {
                        result.error("SERVICE_NOT_RUNNING", "Accessibility service is not running", null)
                    }
                }
                "keepScreenOn" -> {
                    val keep = call.argument<Boolean>("keep") ?: false
                    if (keep) {
                        activity.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    } else {
                        activity.window.clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                    }
                    result.success(true)
                }
                else -> result.notImplemented()
            }
        }
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                NOTIF_CHANNEL_ID,
                "Status Triki-myszka",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Status połączenia BLE z kapslem"
                setSound(null, null)
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    private fun showStatusNotification(title: String, body: String) {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pi = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        val notif = NotificationCompat.Builder(this, NOTIF_CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_compass)
            .setContentTitle(title)
            .setContentText(body)
            .setOngoing(true)
            .setContentIntent(pi)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.notify(NOTIF_ID, notif)
    }
}
