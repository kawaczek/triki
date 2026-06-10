import 'dart:async';
import 'dart:convert';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:permission_handler/permission_handler.dart';

// ═══════════════════════════════════════════════════════════
//  MODELS
// ═══════════════════════════════════════════════════════════

enum MouseMode { air, table }
enum ButtonOrientation { left, front, right }

class DeviceProfile {
  final String id;
  final String name;
  double sensitivityX;
  double sensitivityY;
  double deadzone;

  DeviceProfile({
    required this.id,
    required this.name,
    this.sensitivityX = 1.2,
    this.sensitivityY = 1.2,
    this.deadzone = 0.15,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'sx': sensitivityX,
        'sy': sensitivityY,
        'dz': deadzone,
      };

  factory DeviceProfile.fromJson(Map<String, dynamic> j) => DeviceProfile(
        id: j['id'],
        name: j['name'],
        sensitivityX: j['sx'] ?? 1.2,
        sensitivityY: j['sy'] ?? 1.2,
        deadzone: j['dz'] ?? 0.15,
      );
}

// ═══════════════════════════════════════════════════════════
//  APP ENTRY
// ═══════════════════════════════════════════════════════════

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const TrikiApp());
}

class TrikiApp extends StatefulWidget {
  const TrikiApp({super.key});

  static _TrikiAppState? of(BuildContext context) =>
      context.findAncestorStateOfType<_TrikiAppState>();

  @override
  State<TrikiApp> createState() => _TrikiAppState();
}

class _TrikiAppState extends State<TrikiApp> {
  ThemeMode _themeMode = ThemeMode.dark;

  void toggleTheme() => setState(
      () => _themeMode = _themeMode == ThemeMode.dark ? ThemeMode.light : ThemeMode.dark);

  bool get isDark => _themeMode == ThemeMode.dark;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Triki-myszka',
      debugShowCheckedModeBanner: false,
      themeMode: _themeMode,
      theme: _buildLightTheme(),
      darkTheme: _buildDarkTheme(),
      home: const DashboardPage(),
    );
  }

  ThemeData _buildDarkTheme() => ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF080B10),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF22C55E),
          secondary: Color(0xFF3B82F6),
          surface: Color(0xFF0F1420),
          tertiary: Color(0xFFA855F7),
        ),
        cardColor: const Color(0xFF0F1420),
        appBarTheme: const AppBarTheme(backgroundColor: Colors.transparent, elevation: 0),
        textTheme: const TextTheme(
          bodyLarge:  TextStyle(color: Colors.white),
          bodyMedium: TextStyle(color: Color(0xFFB0B8C8)),
        ),
      );

  ThemeData _buildLightTheme() => ThemeData.light().copyWith(
        scaffoldBackgroundColor: const Color(0xFFF0F4FF),
        colorScheme: const ColorScheme.light(
          primary: Color(0xFF16A34A),
          secondary: Color(0xFF2563EB),
          surface: Color(0xFFFFFFFF),
        ),
        cardColor: Colors.white,
        appBarTheme: const AppBarTheme(backgroundColor: Colors.transparent, elevation: 0),
      );
}

// ═══════════════════════════════════════════════════════════
//  DASHBOARD PAGE
// ═══════════════════════════════════════════════════════════

class DashboardPage extends StatefulWidget {
  const DashboardPage({super.key});

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage>
    with TickerProviderStateMixin {
  static const _ch = MethodChannel('pl.kawak.triki_app/mouse');

  // ── BLE ─────────────────────────────────────────────────
  BluetoothDevice? _connectedDevice;
  BluetoothConnectionState _connState = BluetoothConnectionState.disconnected;
  StreamSubscription<BluetoothConnectionState>? _connStateSub;
  StreamSubscription<List<int>>?              _txSub;
  StreamSubscription<List<ScanResult>>?       _scanSub;
  BluetoothCharacteristic? _rxChar, _txChar;
  bool _isScanning = false;
  List<ScanResult> _scanResults = [];
  int _batteryLevel = -1; // -1 = not available

  // ── Device History & Profiles ────────────────────────────
  List<DeviceProfile> _deviceHistory = [];
  DeviceProfile? _activeProfile;

  // ── Settings ─────────────────────────────────────────────
  String? _savedDeviceId, _savedDeviceName;
  bool _mouseEnabled    = true;
  bool _accelTapClick   = false;
  bool _physicalBtnClick = true;
  bool _scrollMode      = false; // button held → scroll instead of click
  MouseMode         _mouseMode   = MouseMode.air;
  ButtonOrientation _btnOrientation = ButtonOrientation.left;

  // ── Calibration offsets ──────────────────────────────────
  double _offX = 0, _offY = 0, _offZ = 0, _accOffX = 0, _accOffY = 0;

  // ── Telemetry ────────────────────────────────────────────
  double _gx = 0, _gy = 0, _gz = 0;
  double _ax = 0, _ay = 0, _az = 0;
  int    _receivedFrames = 0, _droppedBytes = 0;
  double _sampleRate = 0;
  Timer? _fpsTimer;
  int    _fpsCounter = 0;

  // ── Velocity (table mode) ────────────────────────────────
  double _vx = 0, _vy = 0;

  // ── Button state + gestures ──────────────────────────────
  bool     _btnPressed      = false;
  DateTime _btnPressTime    = DateTime.now();
  int      _clickCount      = 0;      // for double-click detection
  DateTime _lastClickTime   = DateTime.now();
  double   _lastAccelZ      = 0;
  bool     _scrollTriggered = false;

  // ── Stats ─────────────────────────────────────────────────
  int _totalClicks = 0;
  int _totalScrolls = 0;
  DateTime _sessionStart = DateTime.now();

  // ── Accessibility service ─────────────────────────────────
  bool _serviceRunning = false;
  Timer? _serviceTimer;

  // ── Reconnect ─────────────────────────────────────────────
  int _reconnectAttempts = 0;
  static const _maxReconnects = 5;
  Timer? _reconnectTimer;

  // ── RX buffer ────────────────────────────────────────────
  List<int> _rxBuf = [];

  // ── Animations ───────────────────────────────────────────
  late AnimationController _pulseCtrl;
  late Animation<double>   _pulseAnim;

  // ═══════════════════════════════════════════════════════
  @override
  void initState() {
    super.initState();
    _pulseCtrl = AnimationController(vsync: this, duration: const Duration(seconds: 2))
      ..repeat(reverse: true);
    _pulseAnim = Tween(begin: 0.6, end: 1.0).animate(
        CurvedAnimation(parent: _pulseCtrl, curve: Curves.easeInOut));

    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await _requestBlePermissions();
      await _loadAll();
      _serviceTimer = Timer.periodic(const Duration(seconds: 2), (_) => _checkService());
      _fpsTimer = Timer.periodic(const Duration(seconds: 1), (_) {
        if (mounted) setState(() { _sampleRate = _fpsCounter.toDouble(); _fpsCounter = 0; });
      });
      _initBle();
    });
  }

  @override
  void dispose() {
    _pulseCtrl.dispose();
    _fpsTimer?.cancel();
    _serviceTimer?.cancel();
    _reconnectTimer?.cancel();
    _connStateSub?.cancel();
    _txSub?.cancel();
    _scanSub?.cancel();
    _disconnect();
    _ch.invokeMethod('hideNotification').catchError((_) {});
    super.dispose();
  }

  // ═══════════════════════════════════════════════════════
  //  PERMISSIONS
  // ═══════════════════════════════════════════════════════

  Future<void> _requestBlePermissions() async {
    final statuses = await [
      Permission.bluetooth,
      Permission.bluetoothScan,
      Permission.bluetoothConnect,
      Permission.notification,
    ].request();

    final denied = statuses.entries.where((e) =>
        e.value.isDenied || e.value.isPermanentlyDenied).map((e) => e.key).toList();

    if (denied.isNotEmpty && mounted) {
      _showSnack('Brak uprawnień BLE – sprawdź ustawienia aplikacji 🐾');
    }
  }

  // ═══════════════════════════════════════════════════════
  //  PERSISTENCE
  // ═══════════════════════════════════════════════════════

  Future<void> _loadAll() async {
    final p = await SharedPreferences.getInstance();
    final histJson = p.getStringList('device_history') ?? [];
    _deviceHistory = histJson
        .map((s) {
          try { return DeviceProfile.fromJson(jsonDecode(s)); }
          catch (_) { return null; }
        })
        .whereType<DeviceProfile>()
        .toList();

    if (mounted) setState(() {
      _savedDeviceId  = p.getString('saved_device_id');
      _savedDeviceName = p.getString('saved_device_name');
      _mouseEnabled   = p.getBool('mouse_enabled') ?? true;
      _accelTapClick  = p.getBool('accel_tap_click') ?? false;
      _physicalBtnClick = p.getBool('physical_button_click') ?? true;
      _mouseMode      = MouseMode.values[p.getInt('mouse_mode') ?? 0];
      _btnOrientation = ButtonOrientation.values[p.getInt('button_orientation') ?? 0];
      _offX = p.getDouble('offset_x') ?? 0.0;
      _offY = p.getDouble('offset_y') ?? 0.0;
      _offZ = p.getDouble('offset_z') ?? 0.0;
      _accOffX = p.getDouble('accel_offset_x') ?? 0.0;
      _accOffY = p.getDouble('accel_offset_y') ?? 0.0;

      // Load active device profile
      if (_savedDeviceId != null) {
        _activeProfile = _deviceHistory
            .where((d) => d.id == _savedDeviceId)
            .firstOrNull;
        _activeProfile ??= DeviceProfile(
          id: _savedDeviceId!,
          name: _savedDeviceName ?? 'Triki',
          sensitivityX: p.getDouble('sensitivity_x') ?? 1.2,
          sensitivityY: p.getDouble('sensitivity_y') ?? 1.2,
          deadzone: p.getDouble('deadzone') ?? 0.15,
        );
      }
    });

    if (_savedDeviceId != null) _connectToSaved();
  }

  Future<void> _saveHistory() async {
    final p = await SharedPreferences.getInstance();
    await p.setStringList(
        'device_history', _deviceHistory.map((d) => jsonEncode(d.toJson())).toList());
  }

  Future<void> _saveSetting(String key, dynamic v) async {
    final p = await SharedPreferences.getInstance();
    if (v is double)  await p.setDouble(key, v);
    if (v is bool)    await p.setBool(key, v);
    if (v is String)  await p.setString(key, v);
    if (v is int)     await p.setInt(key, v);
  }

  void _saveProfileSettings() {
    if (_activeProfile == null) return;
    _saveSetting('sensitivity_x', _activeProfile!.sensitivityX);
    _saveSetting('sensitivity_y', _activeProfile!.sensitivityY);
    _saveSetting('deadzone',      _activeProfile!.deadzone);
    final idx = _deviceHistory.indexWhere((d) => d.id == _activeProfile!.id);
    if (idx >= 0) _deviceHistory[idx] = _activeProfile!;
    _saveHistory();
  }

  // ═══════════════════════════════════════════════════════
  //  BLE
  // ═══════════════════════════════════════════════════════

  void _initBle() {
    try {
      _scanSub = FlutterBluePlus.scanResults.listen((r) {
        if (mounted) setState(() => _scanResults = r);
      });
      FlutterBluePlus.isScanning.listen((s) {
        if (mounted) setState(() => _isScanning = s);
      });
    } catch (e) { debugPrint('BLE init: $e'); }
  }

  void _startScan() async {
    if (_isScanning) return;
    setState(() => _scanResults = []);
    try {
      await FlutterBluePlus.startScan(timeout: const Duration(seconds: 15));
    } catch (e) { _showSnack('Błąd skanowania: $e'); }
  }

  void _connectToSaved() async {
    if (_savedDeviceId == null) return;
    _reconnectAttempts = 0;
    _doConnect(BluetoothDevice.fromId(_savedDeviceId!), autoConnect: true);
  }

  Future<void> _connectToDevice(BluetoothDevice dev) async {
    FlutterBluePlus.stopScan();
    _reconnectAttempts = 0;
    await _doConnect(dev, autoConnect: false);

    final name = dev.platformName.isNotEmpty ? dev.platformName : 'Triki';
    await _saveSetting('saved_device_id', dev.remoteId.str);
    await _saveSetting('saved_device_name', name);

    // Update history (max 5 devices)
    _deviceHistory.removeWhere((d) => d.id == dev.remoteId.str);
    final existing = _deviceHistory.where((d) => d.id == dev.remoteId.str).firstOrNull;
    final profile = existing ?? DeviceProfile(id: dev.remoteId.str, name: name);
    _deviceHistory.insert(0, profile);
    if (_deviceHistory.length > 5) _deviceHistory = _deviceHistory.sublist(0, 5);
    _activeProfile = profile;
    await _saveHistory();

    if (mounted) setState(() { _savedDeviceId = dev.remoteId.str; _savedDeviceName = name; });
  }

  Future<void> _doConnect(BluetoothDevice dev, {required bool autoConnect}) async {
    setState(() => _connState = BluetoothConnectionState.connecting);
    try {
      _connectedDevice = dev;
      _connStateSub?.cancel();
      _connStateSub = dev.connectionState.listen((s) {
        if (!mounted) return;
        setState(() => _connState = s);
        if (s == BluetoothConnectionState.connected) {
          _reconnectAttempts = 0;
          _discoverServices(dev);
          _updateNotification();
        } else if (s == BluetoothConnectionState.disconnected) {
          _cleanupConn();
          _scheduleReconnect();
          _updateNotification();
        }
      });
      await dev.connect(autoConnect: autoConnect)
          .timeout(Duration(seconds: autoConnect ? 30 : 10));
    } catch (e) {
      setState(() => _connState = BluetoothConnectionState.disconnected);
      _showSnack('Błąd połączenia: $e');
      _scheduleReconnect();
    }
  }

  void _scheduleReconnect() {
    if (_savedDeviceId == null) return;
    if (_reconnectAttempts >= _maxReconnects) {
      _showSnack('Nie można połączyć po $_maxReconnects próbach 😢');
      return;
    }
    final delay = Duration(seconds: 3 + _reconnectAttempts * 2);
    _reconnectAttempts++;
    _showSnack('Auto-reconnect próba $_reconnectAttempts/$_maxReconnects za ${delay.inSeconds}s...');
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(delay, () {
      if (_connState != BluetoothConnectionState.connected && _savedDeviceId != null) {
        _doConnect(BluetoothDevice.fromId(_savedDeviceId!), autoConnect: false);
      }
    });
  }

  Future<void> _discoverServices(BluetoothDevice dev) async {
    const nusService = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
    const nusRx      = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
    const nusTx      = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";
    const batService = "0000180f-0000-1000-8000-00805f9b34fb";
    const batLevel   = "00002a19-0000-1000-8000-00805f9b34fb";

    try {
      final services = await dev.discoverServices();

      // BLE Battery Service
      for (final s in services) {
        if (s.uuid.toString().toLowerCase().contains('180f')) {
          for (final c in s.characteristics) {
            if (c.uuid.toString().toLowerCase().contains('2a19')) {
              final val = await c.read();
              if (mounted && val.isNotEmpty) {
                setState(() => _batteryLevel = val[0]);
              }
              break;
            }
          }
        }
      }

      // Nordic UART Service
      BluetoothService? nus;
      for (final s in services) {
        if (s.uuid.toString().toLowerCase().contains('6e400001')) { nus = s; break; }
      }
      if (nus == null) { _showSnack('Brak NUS!'); _disconnect(); return; }

      for (final c in nus.characteristics) {
        final u = c.uuid.toString().toLowerCase();
        if (u.contains('6e400002')) _rxChar = c;
        if (u.contains('6e400003')) _txChar = c;
      }
      if (_rxChar == null || _txChar == null) { _showSnack('Brak RX/TX!'); _disconnect(); return; }

      await _txChar!.setNotifyValue(true);
      _txSub = _txChar!.lastValueStream.listen(_handleBytes);

      final startCmd = [0x20, 0x10, 0x00, 0xD0, 0x07, 0x68, 0x00, 0x03];
      await _rxChar!.write(startCmd, withoutResponse: true);
      _showSnack('Połączono! 🐾 ${_batteryLevel >= 0 ? "Bat: $_batteryLevel%" : ""}');
    } catch (e) {
      _showSnack('Błąd BLE: $e');
      _disconnect();
    }
  }

  void _disconnect() async {
    _reconnectTimer?.cancel();
    _reconnectAttempts = _maxReconnects; // stop auto-reconnect on manual disconnect
    try { await _connectedDevice?.disconnect(); } catch (_) {}
    _cleanupConn();
    _ch.invokeMethod('hideNotification').catchError((_) {});
  }

  void _cleanupConn() {
    _txSub?.cancel(); _txSub = null;
    _rxChar = null; _txChar = null;
    _connectedDevice = null;
    _rxBuf.clear();
    _batteryLevel = -1;
    if (mounted) setState(() => _connState = BluetoothConnectionState.disconnected);
  }

  void _forgetDevice() async {
    _disconnect();
    final p = await SharedPreferences.getInstance();
    await p.remove('saved_device_id'); await p.remove('saved_device_name');
    setState(() { _savedDeviceId = null; _savedDeviceName = null; _activeProfile = null; });
    _showSnack('Zapomniano urządzenie!');
  }

  // ═══════════════════════════════════════════════════════
  //  FRAME PROCESSING
  // ═══════════════════════════════════════════════════════

  void _handleBytes(List<int> data) {
    _rxBuf.addAll(data);
    while (_rxBuf.length >= 14) {
      int hi = -1;
      for (int i = 0; i < _rxBuf.length - 1; i++) {
        if (_rxBuf[i] == 0x22) { hi = i; break; }
      }
      if (hi == -1) {
        _droppedBytes += _rxBuf.length; _rxBuf.clear(); break;
      }
      if (hi > 0) { _droppedBytes += hi; _rxBuf.removeRange(0, hi); }
      if (_rxBuf.length < 14) break;
      _processFrame(_rxBuf.sublist(0, 14));
      _rxBuf.removeRange(0, 14);
    }
  }

  void _processFrame(List<int> f) {
    _receivedFrames++; _fpsCounter++;

    final btnState = f[1];
    double gx = _i16(f, 2) / 131.0 - _offX;
    double gy = _i16(f, 4) / 131.0 - _offY;
    double gz = _i16(f, 6) / 131.0 - _offZ;
    double ax = _i16(f, 8) / 2048.0 - _accOffX;
    double ay = _i16(f, 10) / 2048.0 - _accOffY;
    double az = _i16(f, 12) / 2048.0;

    // ── Button gestures ──────────────────────────────────
    if (_physicalBtnClick) {
      final pressed = btnState != 0x00;
      if (pressed && !_btnPressed) {
        _btnPressed = true;
        _btnPressTime = DateTime.now();
        _scrollTriggered = false;
      } else if (!pressed && _btnPressed) {
        _btnPressed = false;
        final held = DateTime.now().difference(_btnPressTime).inMilliseconds;
        if (!_scrollTriggered) {
          if (held >= 550) {
            // Long press → right click
            _triggerRightClick();
          } else {
            // Short press → detect double click
            final sinceLastClick = DateTime.now().difference(_lastClickTime).inMilliseconds;
            if (sinceLastClick < 400) {
              _clickCount++;
              if (_clickCount >= 2) {
                _triggerDoubleClick();
                _clickCount = 0;
              }
            } else {
              _clickCount = 1;
              // Delay single-click to allow double-click window
              Future.delayed(const Duration(milliseconds: 400), () {
                if (_clickCount == 1) { _triggerClick(); _clickCount = 0; }
              });
            }
            _lastClickTime = DateTime.now();
          }
        }
      }
    }

    // ── Accel tap click ──────────────────────────────────
    if (_accelTapClick) {
      final diff = (az - _lastAccelZ).abs();
      if (diff > 0.9) {
        final now = DateTime.now();
        if (now.difference(_lastClickTime).inMilliseconds > 450) {
          _lastClickTime = now;
          _triggerClick();
        }
      }
      _lastAccelZ = az;
    }

    if (mounted) setState(() { _gx = gx; _gy = gy; _gz = gz; _ax = ax; _ay = ay; _az = az; });

    if (!_mouseEnabled || !_serviceRunning || _activeProfile == null) return;

    final sx = _activeProfile!.sensitivityX;
    final sy = _activeProfile!.sensitivityY;
    final dz = _activeProfile!.deadzone;

    // ── Orient inputs ─────────────────────────────────────
    double iGx = gx, iGz = gz, iAx = ax, iAy = ay;
    if (_btnOrientation == ButtonOrientation.front) { iGx = gy; iGz = -gx; iAx = ay; iAy = -ax; }
    else if (_btnOrientation == ButtonOrientation.right) { iGx = -gx; iGz = -gz; iAx = -ax; iAy = -ay; }

    // ── Scroll mode (button held + tilt) ─────────────────
    if (_btnPressed && !_scrollTriggered) {
      final heldMs = DateTime.now().difference(_btnPressTime).inMilliseconds;
      if (heldMs > 300 && (iGz.abs() > 5 || iGx.abs() > 5)) {
        _scrollTriggered = true;
        final sdx = (iGz.abs() > iGx.abs()) ? (iGz > 0 ? 1.0 : -1.0) : 0.0;
        final sdy = (iGx.abs() > iGz.abs()) ? (iGx > 0 ? 1.0 : -1.0) : 0.0;
        _ch.invokeMethod('scroll', {'dx': sdx, 'dy': sdy});
        setState(() => _totalScrolls++);
      }
    }

    // ── Move cursor ───────────────────────────────────────
    if (!_scrollTriggered) {
      double dx = 0, dy = 0;
      if (_mouseMode == MouseMode.air) {
        dx = -iGz * sx; dy = iGx * sy;
        if (dx.abs() < dz) dx = 0;
        if (dy.abs() < dz) dy = 0;
      } else {
        const friction = 0.82;
        double inp = iAx, inp2 = iAy;
        if (inp.abs() < 0.08) inp = 0;
        if (inp2.abs() < 0.08) inp2 = 0;
        _vx = (_vx + inp  * 9.81 * 0.02) * friction;
        _vy = (_vy - inp2 * 9.81 * 0.02) * friction;
        dx = _vx * sx * 25; dy = _vy * sy * 25;
      }
      if (dx.abs() > 0.1 || dy.abs() > 0.1) {
        _ch.invokeMethod('moveCursor', {'dx': dx, 'dy': dy});
      }
    }
  }

  int _i16(List<int> b, int o) {
    int v = b[o] | (b[o + 1] << 8);
    return (v & 0x8000) != 0 ? v - 0x10000 : v;
  }

  void _triggerClick()       { if (_serviceRunning) { _ch.invokeMethod('click');       setState(() => _totalClicks++); } }
  void _triggerRightClick()  { if (_serviceRunning) { _ch.invokeMethod('rightClick');  } }
  void _triggerDoubleClick() { if (_serviceRunning) { _ch.invokeMethod('doubleClick'); setState(() => _totalClicks += 2); } }

  // ═══════════════════════════════════════════════════════
  //  MISC
  // ═══════════════════════════════════════════════════════

  Future<void> _checkService() async {
    try {
      final ok = await _ch.invokeMethod<bool>('isServiceRunning') ?? false;
      if (ok != _serviceRunning && mounted) setState(() => _serviceRunning = ok);
    } catch (_) {}
  }

  void _updateNotification() {
    if (_connState == BluetoothConnectionState.connected) {
      _ch.invokeMethod('showNotification', {
        'title': 'Triki-myszka 🐾',
        'body': 'Połączono: ${_savedDeviceName ?? "Kapsel"}'
            '${_batteryLevel >= 0 ? " | Bat: $_batteryLevel%" : ""}',
      }).catchError((_) {});
    } else {
      _ch.invokeMethod('hideNotification').catchError((_) {});
    }
  }

  void _calibrate() async {
    setState(() {
      _offX += _gx; _offY += _gy; _offZ += _gz;
      _accOffX += _ax; _accOffY += _ay;
      _vx = 0; _vy = 0;
    });
    for (final e in {'offset_x': _offX, 'offset_y': _offY, 'offset_z': _offZ,
        'accel_offset_x': _accOffX, 'accel_offset_y': _accOffY}.entries) {
      await _saveSetting(e.key, e.value);
    }
  }

  void _resetOffsets() async {
    setState(() { _offX = _offY = _offZ = _accOffX = _accOffY = _vx = _vy = 0; });
    for (final k in ['offset_x', 'offset_y', 'offset_z', 'accel_offset_x', 'accel_offset_y']) {
      await _saveSetting(k, 0.0);
    }
    _showSnack('Wyczyszczono offsety!');
  }

  void _showSnack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(
      content: Text(msg),
      duration: const Duration(seconds: 3),
      backgroundColor: const Color(0xFF1E293B),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ));
  }

  bool get _isConnected => _connState == BluetoothConnectionState.connected;

  // ═══════════════════════════════════════════════════════
  //  BUILD
  // ═══════════════════════════════════════════════════════

  @override
  Widget build(BuildContext context) {
    final appState = TrikiApp.of(context);
    final isDark = appState?.isDark ?? true;
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      body: CustomScrollView(
        slivers: [
          // ── App Bar ──────────────────────────────────────
          SliverAppBar(
            expandedHeight: 120,
            pinned: true,
            backgroundColor: Colors.transparent,
            flexibleSpace: FlexibleSpaceBar(
              titlePadding: const EdgeInsets.only(left: 16, bottom: 14),
              title: Row(
                children: [
                  _AnimatedFrog(connected: _isConnected),
                  const SizedBox(width: 10),
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Text('Triki-myszka',
                          style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800)),
                      if (_savedDeviceName != null)
                        Text(_savedDeviceName!,
                            style: TextStyle(fontSize: 10, color: cs.primary)),
                    ],
                  ),
                ],
              ),
              background: Container(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                    colors: isDark
                        ? [const Color(0xFF0D1F15), const Color(0xFF080B10)]
                        : [const Color(0xFFDCFCE7), const Color(0xFFF0F4FF)],
                  ),
                ),
              ),
            ),
            actions: [
              // Battery
              if (_batteryLevel >= 0)
                Padding(
                  padding: const EdgeInsets.only(right: 4),
                  child: _BatteryChip(level: _batteryLevel),
                ),
              // Theme toggle
              IconButton(
                icon: Icon(isDark ? Icons.light_mode_rounded : Icons.dark_mode_rounded),
                tooltip: 'Zmień motyw',
                onPressed: () => appState?.toggleTheme(),
              ),
              // Accessibility
              IconButton(
                icon: Icon(Icons.accessibility_new,
                    color: _serviceRunning ? cs.primary : Colors.grey),
                tooltip: 'Usługa dostępności',
                onPressed: () => _ch.invokeMethod('openAccessibilitySettings'),
              ),
              // Disconnect
              if (_isConnected)
                IconButton(
                  icon: const Icon(Icons.link_off, color: Colors.redAccent),
                  onPressed: _disconnect,
                ),
            ],
          ),

          // ── Body ─────────────────────────────────────────
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(14, 0, 14, 80),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                // Connection card
                _buildConnectionCard(cs),
                const SizedBox(height: 12),

                // Controls (only when connected)
                if (_isConnected) ...[
                  _buildMouseCard(cs),
                  const SizedBox(height: 12),
                  _buildTelemetryCard(cs),
                  const SizedBox(height: 12),
                  _buildProfileCard(cs),
                  const SizedBox(height: 12),
                  _buildStatsCard(cs),
                  const SizedBox(height: 12),
                ],

                // History
                if (_deviceHistory.isNotEmpty) _buildHistoryCard(cs),
              ]),
            ),
          ),
        ],
      ),

      // ── FAB: Mouse toggle ────────────────────────────────
      floatingActionButton: _isConnected
          ? FloatingActionButton.extended(
              backgroundColor: _mouseEnabled ? cs.primary : Colors.grey.shade700,
              icon: Icon(_mouseEnabled ? Icons.mouse : Icons.mouse_outlined),
              label: Text(_mouseEnabled ? 'Mysz ON' : 'Mysz OFF'),
              onPressed: () {
                setState(() => _mouseEnabled = !_mouseEnabled);
                _saveSetting('mouse_enabled', _mouseEnabled);
              },
            )
          : null,
    );
  }

  // ═══════════════════════════════════════════════════════
  //  CARD BUILDERS
  // ═══════════════════════════════════════════════════════

  Widget _buildConnectionCard(ColorScheme cs) {
    return _GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          // Status row
          Row(
            children: [
              AnimatedBuilder(
                animation: _pulseAnim,
                builder: (_, __) => Container(
                  width: 12, height: 12,
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    color: _isConnected ? cs.primary : Colors.grey,
                    boxShadow: _isConnected
                        ? [BoxShadow(
                            color: cs.primary.withOpacity(_pulseAnim.value),
                            blurRadius: 12, spreadRadius: 2)]
                        : null,
                  ),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  _isConnected ? 'Połączono' :
                  _connState == BluetoothConnectionState.connecting ? 'Łączenie...' :
                  _reconnectAttempts > 0 ? 'Reconnect ${_reconnectAttempts}/$_maxReconnects...' :
                  'Rozłączony',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: _isConnected ? cs.primary :
                           _reconnectAttempts > 0 ? Colors.amber : Colors.grey,
                  ),
                ),
              ),
              if (!_serviceRunning)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: Colors.orange.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(20),
                    border: Border.all(color: Colors.orange.withOpacity(0.4)),
                  ),
                  child: const Text('Brak usługi', style: TextStyle(fontSize: 11, color: Colors.orange)),
                ),
            ],
          ),

          const SizedBox(height: 14),

          // Scan button
          if (!_isConnected)
            ElevatedButton.icon(
              style: ElevatedButton.styleFrom(
                backgroundColor: cs.primary,
                foregroundColor: Colors.black,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              icon: _isScanning
                  ? const SizedBox(width: 18, height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.black))
                  : const Icon(Icons.bluetooth_searching),
              label: Text(_isScanning ? 'Skanowanie...' : 'Skanuj BLE'),
              onPressed: _isScanning ? FlutterBluePlus.stopScan : _startScan,
            ),

          // Scan results
          if (_scanResults.isNotEmpty) ...[
            const SizedBox(height: 12),
            ...(_scanResults.take(8).map((r) => _ScanResultTile(
              result: r,
              onTap: () => _connectToDevice(r.device),
            ))),
          ],

          // Forget device
          if (_savedDeviceId != null && !_isConnected) ...[
            const SizedBox(height: 8),
            TextButton.icon(
              icon: const Icon(Icons.delete_outline, size: 16),
              label: Text('Zapomnij: ${_savedDeviceName ?? _savedDeviceId}'),
              style: TextButton.styleFrom(foregroundColor: Colors.redAccent, textStyle: const TextStyle(fontSize: 12)),
              onPressed: _forgetDevice,
            ),
          ],
        ],
      ),
    );
  }

  Widget _buildMouseCard(ColorScheme cs) {
    return _GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _CardTitle(icon: Icons.mouse, label: 'Sterowanie myszą', color: cs.primary),
          const SizedBox(height: 12),

          // Mode toggle
          Row(children: [
            _ModeChip(
              label: '✈️ Powietrzna',
              selected: _mouseMode == MouseMode.air,
              color: cs.primary,
              onTap: () { setState(() => _mouseMode = MouseMode.air); _saveSetting('mouse_mode', 0); },
            ),
            const SizedBox(width: 8),
            _ModeChip(
              label: '🖱️ Stołowa',
              selected: _mouseMode == MouseMode.table,
              color: cs.secondary,
              onTap: () { setState(() => _mouseMode = MouseMode.table); _saveSetting('mouse_mode', 1); },
            ),
          ]),

          const SizedBox(height: 12),

          // Orientation
          const Text('Orientacja przycisku', style: TextStyle(fontSize: 12, color: Colors.grey)),
          const SizedBox(height: 6),
          Row(children: ButtonOrientation.values.map((o) {
            final labels = ['◀ Lewo', '▼ Przód', '▶ Prawo'];
            return Expanded(child: Padding(
              padding: const EdgeInsets.only(right: 4),
              child: _ModeChip(
                label: labels[o.index],
                selected: _btnOrientation == o,
                color: cs.tertiary,
                onTap: () { setState(() => _btnOrientation = o); _saveSetting('button_orientation', o.index); },
              ),
            ));
          }).toList()),

          const SizedBox(height: 12),
          const Divider(height: 1),
          const SizedBox(height: 12),

          // Toggles
          _ToggleRow(
            icon: Icons.touch_app,
            label: 'Przycisk fizyczny (klik/długi=PPM/podwójny)',
            value: _physicalBtnClick,
            onChanged: (v) { setState(() => _physicalBtnClick = v); _saveSetting('physical_button_click', v); },
            color: cs.primary,
          ),
          _ToggleRow(
            icon: Icons.vibration,
            label: 'Klik uderzeniem (accel tap)',
            value: _accelTapClick,
            onChanged: (v) { setState(() => _accelTapClick = v); _saveSetting('accel_tap_click', v); },
            color: cs.secondary,
          ),

          const SizedBox(height: 12),
          // Calibration
          Row(children: [
            Expanded(
              child: OutlinedButton.icon(
                icon: const Icon(Icons.my_location, size: 16),
                label: const Text('Kalibruj zero', style: TextStyle(fontSize: 12)),
                onPressed: _calibrate,
                style: OutlinedButton.styleFrom(
                  foregroundColor: cs.primary,
                  side: BorderSide(color: cs.primary.withOpacity(0.4)),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ),
            const SizedBox(width: 8),
            Expanded(
              child: OutlinedButton.icon(
                icon: const Icon(Icons.restart_alt, size: 16),
                label: const Text('Reset offset', style: TextStyle(fontSize: 12)),
                onPressed: _resetOffsets,
                style: OutlinedButton.styleFrom(
                  foregroundColor: Colors.orange,
                  side: BorderSide(color: Colors.orange.withOpacity(0.4)),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
              ),
            ),
          ]),
        ],
      ),
    );
  }

  Widget _buildProfileCard(ColorScheme cs) {
    if (_activeProfile == null) return const SizedBox.shrink();
    final p = _activeProfile!;
    return _GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _CardTitle(icon: Icons.tune, label: 'Profil: ${p.name}', color: cs.secondary),
          const SizedBox(height: 14),
          _Slider3(
            label: 'Czułość X', value: p.sensitivityX, min: 0.3, max: 5.0,
            color: cs.primary,
            onChanged: (v) { setState(() => p.sensitivityX = v); _saveProfileSettings(); },
          ),
          _Slider3(
            label: 'Czułość Y', value: p.sensitivityY, min: 0.3, max: 5.0,
            color: cs.primary,
            onChanged: (v) { setState(() => p.sensitivityY = v); _saveProfileSettings(); },
          ),
          _Slider3(
            label: 'Martwa strefa', value: p.deadzone, min: 0.0, max: 1.0,
            color: cs.secondary,
            onChanged: (v) { setState(() => p.deadzone = v); _saveProfileSettings(); },
          ),
        ],
      ),
    );
  }

  Widget _buildTelemetryCard(ColorScheme cs) {
    return _GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              _CardTitle(icon: Icons.sensors, label: 'Telemetria', color: cs.tertiary),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(
                  color: cs.tertiary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(20),
                ),
                child: Text('${_sampleRate.toInt()} Hz',
                    style: TextStyle(fontSize: 11, color: cs.tertiary, fontWeight: FontWeight.bold)),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: _ValueCard('Gx', _gx.toStringAsFixed(1), cs.primary)),
            const SizedBox(width: 6),
            Expanded(child: _ValueCard('Gy', _gy.toStringAsFixed(1), cs.secondary)),
            const SizedBox(width: 6),
            Expanded(child: _ValueCard('Gz', _gz.toStringAsFixed(1), cs.tertiary)),
          ]),
          const SizedBox(height: 8),
          Row(children: [
            Expanded(child: _ValueCard('Ax', _ax.toStringAsFixed(2), cs.primary)),
            const SizedBox(width: 6),
            Expanded(child: _ValueCard('Ay', _ay.toStringAsFixed(2), cs.secondary)),
            const SizedBox(width: 6),
            Expanded(child: _ValueCard('Az', _az.toStringAsFixed(2), cs.tertiary)),
          ]),
          const SizedBox(height: 10),
          Row(children: [
            Expanded(child: _MiniStat('Frames', _receivedFrames.toString())),
            Expanded(child: _MiniStat('Dropped', _droppedBytes.toString())),
          ]),
        ],
      ),
    );
  }

  Widget _buildStatsCard(ColorScheme cs) {
    final uptime = DateTime.now().difference(_sessionStart);
    final mm = uptime.inMinutes;
    final ss = uptime.inSeconds % 60;
    return _GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _CardTitle(icon: Icons.bar_chart, label: 'Statystyki sesji', color: cs.secondary),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(child: _StatBadge('🖱️ Kliki', _totalClicks.toString(), cs.primary)),
            const SizedBox(width: 8),
            Expanded(child: _StatBadge('📜 Scroll', _totalScrolls.toString(), cs.secondary)),
            const SizedBox(width: 8),
            Expanded(child: _StatBadge('⏱️ Czas', '${mm}m ${ss}s', cs.tertiary)),
          ]),
        ],
      ),
    );
  }

  Widget _buildHistoryCard(ColorScheme cs) {
    return _GlassCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _CardTitle(icon: Icons.history, label: 'Historia urządzeń', color: Colors.amber),
          const SizedBox(height: 8),
          ..._deviceHistory.map((d) => ListTile(
            dense: true,
            contentPadding: EdgeInsets.zero,
            leading: CircleAvatar(
              radius: 16,
              backgroundColor: d.id == _savedDeviceId
                  ? cs.primary.withOpacity(0.2) : Colors.white10,
              child: Icon(Icons.bluetooth,
                  size: 16,
                  color: d.id == _savedDeviceId ? cs.primary : Colors.grey),
            ),
            title: Text(d.name, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
            subtitle: Text(d.id, style: const TextStyle(fontSize: 10, color: Colors.grey)),
            trailing: d.id == _savedDeviceId
                ? Icon(Icons.check_circle, color: cs.primary, size: 18)
                : TextButton(
                    onPressed: () => _connectToDevice(BluetoothDevice.fromId(d.id)),
                    child: const Text('Połącz', style: TextStyle(fontSize: 11)),
                  ),
          )).toList(),
        ],
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════
//  REUSABLE WIDGETS
// ═══════════════════════════════════════════════════════════

class _GlassCard extends StatelessWidget {
  final Widget child;
  const _GlassCard({required this.child});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isDark
            ? const Color(0xFF0F1420).withOpacity(0.85)
            : Colors.white.withOpacity(0.9),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(
          color: isDark ? Colors.white.withOpacity(0.07) : Colors.black.withOpacity(0.06),
        ),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(isDark ? 0.4 : 0.08),
            blurRadius: 20,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: child,
    );
  }
}

class _CardTitle extends StatelessWidget {
  final IconData icon;
  final String label;
  final Color color;
  const _CardTitle({required this.icon, required this.label, required this.color});

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Container(
        padding: const EdgeInsets.all(6),
        decoration: BoxDecoration(
          color: color.withOpacity(0.12),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Icon(icon, size: 16, color: color),
      ),
      const SizedBox(width: 8),
      Expanded(
        child: Text(label,
            style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
            overflow: TextOverflow.ellipsis),
      ),
    ],
  );
}

class _ModeChip extends StatelessWidget {
  final String label;
  final bool selected;
  final Color color;
  final VoidCallback onTap;
  const _ModeChip({required this.label, required this.selected, required this.color, required this.onTap});

  @override
  Widget build(BuildContext context) => GestureDetector(
    onTap: onTap,
    child: AnimatedContainer(
      duration: const Duration(milliseconds: 200),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        color: selected ? color.withOpacity(0.2) : Colors.transparent,
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: selected ? color : Colors.white24, width: selected ? 1.5 : 1),
      ),
      child: Text(label,
          textAlign: TextAlign.center,
          style: TextStyle(
              fontSize: 12, fontWeight: FontWeight.w600,
              color: selected ? color : Colors.grey)),
    ),
  );
}

class _ToggleRow extends StatelessWidget {
  final IconData icon;
  final String label;
  final bool value;
  final ValueChanged<bool> onChanged;
  final Color color;
  const _ToggleRow({required this.icon, required this.label, required this.value,
      required this.onChanged, required this.color});

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 4),
    child: Row(children: [
      Icon(icon, size: 16, color: color),
      const SizedBox(width: 8),
      Expanded(child: Text(label, style: const TextStyle(fontSize: 12))),
      Switch.adaptive(
        value: value,
        onChanged: onChanged,
        activeColor: color,
      ),
    ]),
  );
}

class _Slider3 extends StatelessWidget {
  final String label;
  final double value, min, max;
  final ValueChanged<double> onChanged;
  final Color color;
  const _Slider3({required this.label, required this.value, required this.min,
      required this.max, required this.onChanged, required this.color});

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontSize: 12, color: Colors.grey)),
          Text(value.toStringAsFixed(2),
              style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold, color: color)),
        ],
      ),
      SliderTheme(
        data: SliderThemeData(
          activeTrackColor: color,
          thumbColor: color,
          inactiveTrackColor: color.withOpacity(0.15),
          thumbShape: const RoundSliderThumbShape(enabledThumbRadius: 7),
          overlayShape: const RoundSliderOverlayShape(overlayRadius: 14),
        ),
        child: Slider(value: value, min: min, max: max, onChanged: onChanged),
      ),
    ],
  );
}

class _ValueCard extends StatelessWidget {
  final String label, value;
  final Color color;
  const _ValueCard(this.label, this.value, this.color);

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 8),
    decoration: BoxDecoration(
      color: color.withOpacity(0.07),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: color.withOpacity(0.2)),
    ),
    child: Column(
      children: [
        Text(label, style: const TextStyle(fontSize: 10, color: Colors.grey)),
        const SizedBox(height: 2),
        Text(value,
            style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold, color: color,
                fontFamily: 'monospace')),
      ],
    ),
  );
}

class _MiniStat extends StatelessWidget {
  final String label, value;
  const _MiniStat(this.label, this.value);

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(horizontal: 4),
    child: Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(fontSize: 11, color: Colors.grey)),
        Text(value, style: const TextStyle(fontSize: 11, fontWeight: FontWeight.bold,
            fontFamily: 'monospace')),
      ],
    ),
  );
}

class _StatBadge extends StatelessWidget {
  final String label, value;
  final Color color;
  const _StatBadge(this.label, this.value, this.color);

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
    decoration: BoxDecoration(
      gradient: LinearGradient(
        colors: [color.withOpacity(0.15), color.withOpacity(0.05)],
        begin: Alignment.topLeft, end: Alignment.bottomRight,
      ),
      borderRadius: BorderRadius.circular(14),
      border: Border.all(color: color.withOpacity(0.3)),
    ),
    child: Column(
      children: [
        Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: color)),
        const SizedBox(height: 2),
        Text(label, style: const TextStyle(fontSize: 10, color: Colors.grey)),
      ],
    ),
  );
}

class _BatteryChip extends StatelessWidget {
  final int level;
  const _BatteryChip({required this.level});

  @override
  Widget build(BuildContext context) {
    final color = level > 60 ? Colors.green : level > 20 ? Colors.amber : Colors.red;
    final icon  = level > 60 ? Icons.battery_full : level > 20
        ? Icons.battery_4_bar : Icons.battery_alert;
    return Chip(
      avatar: Icon(icon, size: 14, color: color),
      label: Text('$level%', style: TextStyle(fontSize: 11, color: color, fontWeight: FontWeight.bold)),
      backgroundColor: color.withOpacity(0.12),
      side: BorderSide(color: color.withOpacity(0.3)),
      padding: EdgeInsets.zero,
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
    );
  }
}

class _ScanResultTile extends StatelessWidget {
  final ScanResult result;
  final VoidCallback onTap;
  const _ScanResultTile({required this.result, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final name = result.device.platformName.isNotEmpty
        ? result.device.platformName : 'Nieznane';
    final rssi = result.rssi;
    final color = rssi > -60 ? Colors.green : rssi > -80 ? Colors.amber : Colors.red;
    return ListTile(
      dense: true,
      contentPadding: const EdgeInsets.symmetric(horizontal: 4),
      leading: Container(
        padding: const EdgeInsets.all(8),
        decoration: BoxDecoration(
          color: color.withOpacity(0.12),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(Icons.bluetooth, color: color, size: 18),
      ),
      title: Text(name, style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600)),
      subtitle: Text(result.device.remoteId.str,
          style: const TextStyle(fontSize: 10, color: Colors.grey)),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text('$rssi dBm', style: TextStyle(fontSize: 11, color: color)),
          const SizedBox(width: 6),
          ElevatedButton(
            style: ElevatedButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.primary,
              foregroundColor: Colors.black,
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
              textStyle: const TextStyle(fontSize: 12),
            ),
            onPressed: onTap,
            child: const Text('Łącz'),
          ),
        ],
      ),
    );
  }
}

class _AnimatedFrog extends StatefulWidget {
  final bool connected;
  const _AnimatedFrog({required this.connected});

  @override
  State<_AnimatedFrog> createState() => _AnimatedFrogState();
}

class _AnimatedFrogState extends State<_AnimatedFrog> with SingleTickerProviderStateMixin {
  late AnimationController _ctrl;
  late Animation<double> _scale;

  @override
  void initState() {
    super.initState();
    _ctrl = AnimationController(vsync: this, duration: const Duration(milliseconds: 800));
    _scale = Tween(begin: 1.0, end: 1.15)
        .animate(CurvedAnimation(parent: _ctrl, curve: Curves.elasticOut));
  }

  @override
  void didUpdateWidget(_AnimatedFrog old) {
    super.didUpdateWidget(old);
    if (widget.connected && !old.connected) {
      _ctrl.forward(from: 0).then((_) => _ctrl.reverse());
    }
  }

  @override
  void dispose() { _ctrl.dispose(); super.dispose(); }

  @override
  Widget build(BuildContext context) => ScaleTransition(
    scale: _scale,
    child: Text(widget.connected ? '🐸' : '🐾',
        style: const TextStyle(fontSize: 22)),
  );
}
