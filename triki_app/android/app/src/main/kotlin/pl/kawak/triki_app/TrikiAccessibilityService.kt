package pl.kawak.triki_app

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Color
import android.graphics.Path
import android.graphics.PixelFormat
import android.os.Build
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
        var isOverlayEnabled = true
    }

    private var windowManager: WindowManager? = null
    private var cursorView: View? = null
    private var params: WindowManager.LayoutParams? = null

    var cursorX = 500f
    var cursorY = 1000f

    private var screenWidth  = 1080
    private var screenHeight = 2400

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        windowManager = getSystemService(WINDOW_SERVICE) as WindowManager
        val dm = resources.displayMetrics
        screenWidth  = dm.widthPixels
        screenHeight = dm.heightPixels
        cursorX = screenWidth  / 2f
        cursorY = screenHeight / 2f
        if (isOverlayEnabled) {
            createCursorOverlay()
        }
        Log.d("TrikiService", "Service connected ${screenWidth}x${screenHeight}")
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

    // ── Cursor overlay ──────────────────────────────────────────────────────

    private fun createCursorOverlay() {
        if (cursorView != null) return
        val density = resources.displayMetrics.density
        val size    = (30 * density).toInt()
        val stroke  = (3  * density).toInt()

        val container = FrameLayout(this)

        // Outer ring (white glow)
        val ring = View(this).apply {
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(Color.TRANSPARENT)
                setStroke(stroke, Color.WHITE)
            }
        }
        // Inner dot (neon green)
        val dot = View(this).apply {
            val innerSize = (12 * density).toInt()
            background = android.graphics.drawable.GradientDrawable().apply {
                shape = android.graphics.drawable.GradientDrawable.OVAL
                setColor(Color.parseColor("#22C55E"))
            }
            layoutParams = FrameLayout.LayoutParams(innerSize, innerSize, Gravity.CENTER)
        }

        container.addView(ring,  FrameLayout.LayoutParams(size, size, Gravity.CENTER))
        container.addView(dot)

        params = WindowManager.LayoutParams(
            size, size,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.LEFT
            x = cursorX.toInt() - size / 2
            y = cursorY.toInt() - size / 2
        }

        try {
            windowManager?.addView(container, params)
            cursorView = container
        } catch (e: Exception) {
            Log.e("TrikiService", "Failed to add cursor overlay", e)
        }
    }

    private fun removeCursorOverlay() {
        cursorView?.let {
            try { windowManager?.removeView(it) } catch (_: Exception) {}
        }
        cursorView = null
    }

    fun setCursorOverlayVisible(visible: Boolean) {
        isOverlayEnabled = visible
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            if (visible) {
                if (cursorView == null) {
                    createCursorOverlay()
                }
            } else {
                removeCursorOverlay()
            }
        }
    }

    // ── Public actions ───────────────────────────────────────────────────────

    fun moveCursor(dx: Float, dy: Float) {
        val dm = resources.displayMetrics
        screenWidth  = dm.widthPixels
        screenHeight = dm.heightPixels
        cursorX = (cursorX + dx).coerceIn(0f, screenWidth.toFloat())
        cursorY = (cursorY + dy).coerceIn(0f, screenHeight.toFloat())
        params?.let {
            it.x = (cursorX - it.width  / 2).toInt()
            it.y = (cursorY - it.height / 2).toInt()
            try { windowManager?.updateViewLayout(cursorView, it) } catch (_: Exception) {}
        }
    }

    fun performClick() {
        val path = Path().apply { moveTo(cursorX, cursorY) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 60)
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    fun performDoubleClick() {
        val path1 = Path().apply { moveTo(cursorX, cursorY) }
        val path2 = Path().apply { moveTo(cursorX, cursorY) }
        val s1 = GestureDescription.StrokeDescription(path1, 0,   60)
        val s2 = GestureDescription.StrokeDescription(path2, 150, 60)
        dispatchGesture(
            GestureDescription.Builder().addStroke(s1).addStroke(s2).build(),
            null, null
        )
    }

    fun performRightClick() {
        // Long press (600ms) = system right-click on most apps
        val path = Path().apply { moveTo(cursorX, cursorY) }
        val stroke = GestureDescription.StrokeDescription(path, 0, 600)
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    fun performScroll(dx: Float, dy: Float) {
        val dist = 250f
        val path = Path().apply {
            moveTo(cursorX, cursorY)
            lineTo(cursorX + dx * dist, cursorY + dy * dist)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, 200)
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    fun performSwipe(direction: String) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        val dm = resources.displayMetrics
        val width = dm.widthPixels.toFloat()
        val height = dm.heightPixels.toFloat()
        
        val startY = if (direction == "UP") height * 0.8f else height * 0.2f
        val endY = if (direction == "UP") height * 0.2f else height * 0.8f
        val x = width / 2f

        val path = Path().apply {
            moveTo(x, startY)
            lineTo(x, endY)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0, 250)
        dispatchGesture(GestureDescription.Builder().addStroke(stroke).build(), null, null)
    }

    fun performDoubleTapAtCenter() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return
        val dm = resources.displayMetrics
        val x = dm.widthPixels / 2f
        val y = dm.heightPixels / 2f

        val path1 = Path().apply { moveTo(x, y) }
        val path2 = Path().apply { moveTo(x, y) }
        val s1 = GestureDescription.StrokeDescription(path1, 0, 60)
        val s2 = GestureDescription.StrokeDescription(path2, 150, 60)
        dispatchGesture(
            GestureDescription.Builder().addStroke(s1).addStroke(s2).build(),
            null, null
        )
    }
}
