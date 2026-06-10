package pl.kawak.triki_app

import android.content.Intent
import android.provider.Settings
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

class MainActivity : FlutterActivity() {
    private val CHANNEL = "pl.kawak.triki_app/mouse"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL).setMethodCallHandler { call, result ->
            when (call.method) {
                "isServiceRunning" -> {
                    val isRunning = TrikiAccessibilityService.instance != null
                    result.success(isRunning)
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
                    val service = TrikiAccessibilityService.instance
                    if (service != null) {
                        service.performClick()
                        result.success(true)
                    } else {
                        result.error("SERVICE_NOT_RUNNING", "Accessibility service is not running", null)
                    }
                }
                "openAccessibilitySettings" -> {
                    val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
                    intent.flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    startActivity(intent)
                    result.success(true)
                }
                else -> {
                    result.notImplemented()
                }
            }
        }
    }
}
