package pl.kawak.triki_app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Color
import android.graphics.Path
import android.graphics.PixelFormat
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.FrameLayout
import android.util.Log

class TrikiAccessibilityService : AccessibilityService() {

    companion object {
        var instance: TrikiAccessibilityService? = null
            private set
    }

    private var windowManager: WindowManager? = null
    private var cursorView: View? = null
    private var params: WindowManager.LayoutParams? = null

    // Cursor position in screen pixels
    var cursorX = 500f
    var cursorY = 1000f

    // Screen dimensions
    private var screenWidth = 1080
    private var screenHeight = 2400

    override fun onCreate() {
        super.onCreate()
        Log.d("TrikiService", "onCreate")
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.d("TrikiService", "Service connected!")

        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        val displayMetrics = resources.displayMetrics
        screenWidth = displayMetrics.widthPixels
        screenHeight = displayMetrics.heightPixels
        cursorX = screenWidth / 2f
        cursorY = screenHeight / 2f

        createCursorOverlay()
    }

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        removeCursorOverlay()
        instance = null
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        removeCursorOverlay()
        instance = null
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    private fun createCursorOverlay() {
        if (cursorView != null) return

        val size = (32 * resources.displayMetrics.density).toInt()
        
        val container = FrameLayout(this)
        val pointer = View(this).apply {
            val strokeWidth = (3 * resources.displayMetrics.density).toInt()
            val gd = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(Color.parseColor("#39FF14")) // Neon Green cursor
                setStroke(strokeWidth, Color.WHITE)
            }
            background = gd
        }
        
        container.addView(pointer, FrameLayout.LayoutParams(size, size, Gravity.CENTER))

        params = WindowManager.LayoutParams(
            size,
            size,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.LEFT
            x = cursorX.toInt() - size / 2
            y = cursorY.toInt() - size / 2
        }

        try {
            windowManager?.addView(container, params)
            cursorView = container
            Log.d("TrikiService", "Cursor overlay created at $cursorX, $cursorY")
        } catch (e: Exception) {
            Log.e("TrikiService", "Failed to add cursor overlay", e)
        }
    }

    private fun removeCursorOverlay() {
        cursorView?.let {
            try {
                windowManager?.removeView(it)
            } catch (e: Exception) {
                Log.e("TrikiService", "Error removing cursor view", e)
            }
        }
        cursorView = null
    }

    fun moveCursor(dx: Float, dy: Float) {
        val displayMetrics = resources.displayMetrics
        screenWidth = displayMetrics.widthPixels
        screenHeight = displayMetrics.heightPixels

        cursorX = (cursorX + dx).coerceIn(0f, screenWidth.toFloat())
        cursorY = (cursorY + dy).coerceIn(0f, screenHeight.toFloat())

        params?.let {
            val size = it.width
            it.x = (cursorX - size / 2).toInt()
            it.y = (cursorY - size / 2).toInt()
            
            try {
                windowManager?.updateViewLayout(cursorView, it)
            } catch (e: Exception) {
                Log.e("TrikiService", "Error updating cursor position", e)
            }
        }
    }

    fun performClick() {
        Log.d("TrikiService", "Performing click at $cursorX, $cursorY")
        val path = Path().apply {
            moveTo(cursorX, cursorY)
        }
        val builder = GestureDescription.Builder()
        val stroke = GestureDescription.StrokeDescription(path, 0, 50)
        builder.addStroke(stroke)
        dispatchGesture(builder.build(), null, null)
    }
}
