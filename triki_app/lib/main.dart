import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_blue_plus/flutter_blue_plus.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  runApp(const TrikiApp());
}

class TrikiApp extends StatelessWidget {
  const TrikiApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Triki Mouse',
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF0A0C10),
        colorScheme: const ColorScheme.dark(
          primary: Color(0xFF22C55E), // Żabka Neon Green
          secondary: Color(0xFF3B82F6), // Glow Accent Blue
          surface: Color(0xFF12161E),
        ),
      ),
      home: const DashboardPage(),
    );
  }
}

class DashboardPage extends StatefulWidget {
  const DashboardPage({super.key});

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  static const MethodChannel _mouseChannel = MethodChannel('pl.kawak.triki_app/mouse');

  // BLE status variables
  BluetoothDevice? _connectedDevice;
  BluetoothConnectionState _connectionState = BluetoothConnectionState.disconnected;
  StreamSubscription<BluetoothConnectionState>? _connStateSub;
  StreamSubscription<List<int>>? _txSub;
  BluetoothCharacteristic? _rxChar;
  BluetoothCharacteristic? _txChar;

  bool _isScanning = false;
  List<ScanResult> _scanResults = [];
  StreamSubscription<List<ScanResult>>? _scanSub;

  // Auto-connect and saved settings
  String? _savedDeviceId;
  double _sensitivityX = 1.0;
  double _sensitivityY = 1.0;
  double _deadzone = 0.15;
  bool _mouseEnabled = true;
  bool _accelTapClick = true;
  bool _volumeKeyClick = true;

  // Calibration Offsets
  double _offsetX = 0.0;
  double _offsetY = 0.0;
  double _offsetZ = 0.0;

  // Telemetry parsed state
  double _gyroX = 0.0, _gyroY = 0.0, _gyroZ = 0.0;
  double _accelX = 0.0, _accelY = 0.0, _accelZ = 0.0;
  int _receivedFrames = 0;
  int _droppedBytes = 0;
  double _sampleRate = 0.0;
  Timer? _fpsTimer;
  int _fpsCounter = 0;

  // Accessibility service status
  bool _isAccessibilityServiceRunning = false;
  Timer? _serviceCheckTimer;

  // Buffer for NUS packets
  List<int> _rxBuffer = [];

  // Shock/Tap Click detection variables
  double _lastAccelZ = 0.0;
  DateTime _lastClickTime = DateTime.now();

  @override
  void initState() {
    super.initState();
    _loadSettings();
    _checkAccessibilityService();
    _serviceCheckTimer = Timer.periodic(const Duration(seconds: 2), (timer) {
      _checkAccessibilityService();
    });

    // Start FPS counter
    _fpsTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      setState(() {
        _sampleRate = _fpsCounter.toDouble();
        _fpsCounter = 0;
      });
    });

    // Request permissions and start scanning/reconnect
    _initBluetooth();
  }

  @override
  void dispose() {
    _fpsTimer?.cancel();
    _serviceCheckTimer?.cancel();
    _connStateSub?.cancel();
    _txSub?.cancel();
    _scanSub?.cancel();
    _disconnect();
    super.dispose();
  }

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _savedDeviceId = prefs.getString('saved_device_id');
      _sensitivityX = prefs.getDouble('sensitivity_x') ?? 1.0;
      _sensitivityY = prefs.getDouble('sensitivity_y') ?? 1.0;
      _deadzone = prefs.getDouble('deadzone') ?? 0.15;
      _mouseEnabled = prefs.getBool('mouse_enabled') ?? true;
      _accelTapClick = prefs.getBool('accel_tap_click') ?? true;
      _volumeKeyClick = prefs.getBool('volume_key_click') ?? true;
      _offsetX = prefs.getDouble('offset_x') ?? 0.0;
      _offsetY = prefs.getDouble('offset_y') ?? 0.0;
      _offsetZ = prefs.getDouble('offset_z') ?? 0.0;
    });

    if (_savedDeviceId != null) {
      _tryAutoConnect();
    }
  }

  Future<void> _saveSetting(String key, dynamic value) async {
    final prefs = await SharedPreferences.getInstance();
    if (value is double) {
      await prefs.setDouble(key, value);
    } else if (value is bool) {
      await prefs.setBool(key, value);
    } else if (value is String) {
      await prefs.setString(key, value);
    }
  }

  Future<void> _checkAccessibilityService() async {
    try {
      final bool isRunning = await _mouseChannel.invokeMethod('isServiceRunning');
      if (isRunning != _isAccessibilityServiceRunning) {
        setState(() {
          _isAccessibilityServiceRunning = isRunning;
        });
      }
    } catch (e) {
      debugPrint("Error checking service: $e");
    }
  }

  void _initBluetooth() {
    // Watch scan results
    _scanSub = FlutterBluePlus.scanResults.listen((results) {
      setState(() {
        _scanResults = results;
      });
    });

    FlutterBluePlus.isScanning.listen((scanning) {
      setState(() {
        _isScanning = scanning;
      });
    });
  }

  void _startScan() async {
    if (_isScanning) return;
    _scanResults.clear();
    try {
      await FlutterBluePlus.startScan(timeout: const Duration(seconds: 15));
    } catch (e) {
      _showSnackBar("Błąd skanowania: $e");
    }
  }

  void _stopScan() async {
    await FlutterBluePlus.stopScan();
  }

  void _tryAutoConnect() async {
    _showSnackBar("Próba automatycznego łączenia...");
    // Scan briefly to find the saved device
    _startScan();
    await Future.delayed(const Duration(seconds: 4));
    if (_connectedDevice != null) return; // Already connected

    for (var r in _scanResults) {
      if (r.device.remoteId.str == _savedDeviceId) {
        _connectToDevice(r.device);
        break;
      }
    }
    _stopScan();
  }

  Future<void> _connectToDevice(BluetoothDevice device) async {
    _stopScan();
    setState(() {
      _connectionState = BluetoothConnectionState.connecting;
    });

    try {
      await device.connect(autoConnect: false).timeout(const Duration(seconds: 8));
      _connectedDevice = device;
      
      // Save for auto-connect
      await _saveSetting('saved_device_id', device.remoteId.str);
      _savedDeviceId = device.remoteId.str;

      _connStateSub = device.connectionState.listen((state) {
        setState(() {
          _connectionState = state;
        });
        if (state == BluetoothConnectionState.disconnected) {
          _cleanupConnection();
        }
      });

      _discoverServices(device);
    } catch (e) {
      setState(() {
        _connectionState = BluetoothConnectionState.disconnected;
      });
      _showSnackBar("Błąd połączenia: $e");
    }
  }

  Future<void> _discoverServices(BluetoothDevice device) async {
    try {
      List<BluetoothService> services = await device.discoverServices();
      const nusServiceUuid = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
      const nusRxUuid = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
      const nusTxUuid = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

      BluetoothService? nusService;
      for (var s in services) {
        if (s.uuid.toString().toLowerCase().contains(nusServiceUuid)) {
          nusService = s;
          break;
        }
      }

      if (nusService == null) {
        _showSnackBar("Nie znaleziono usługi Nordic UART!");
        _disconnect();
        return;
      }

      for (var c in nusService.characteristics) {
        final charUuid = c.uuid.toString().toLowerCase();
        if (charUuid.contains(nusRxUuid)) {
          _rxChar = c;
        } else if (charUuid.contains(nusTxUuid)) {
          _txChar = c;
        }
      }

      if (_rxChar == null || _txChar == null) {
        _showSnackBar("Brak wymaganych charakterystyk RX/TX!");
        _disconnect();
        return;
      }

      // Start notifications on TX
      await _txChar!.setNotifyValue(true);
      _txSub = _txChar!.lastValueStream.listen((data) {
        _handleRawBytes(data);
      });

      // Write START command to RX: 201000D007680003
      final startCmd = [0x20, 0x10, 0x00, 0xD0, 0x07, 0x68, 0x00, 0x03];
      await _rxChar!.write(startCmd, withoutResponse: true);

      _showSnackBar("Połączono z Triki i aktywowano stream! 🐾");
    } catch (e) {
      _showSnackBar("Błąd konfiguracji usług: $e");
      _disconnect();
    }
  }

  void _handleRawBytes(List<int> data) {
    _rxBuffer.addAll(data);

    while (_rxBuffer.length >= 14) {
      int headerIdx = -1;
      for (int i = 0; i < _rxBuffer.length - 1; i++) {
        if (_rxBuffer[i] == 0x22 && _rxBuffer[i + 1] == 0x00) {
          headerIdx = i;
          break;
        }
      }

      if (headerIdx == -1) {
        if (_rxBuffer.last == 0x22) {
          _droppedBytes += _rxBuffer.length - 1;
          _rxBuffer = [0x22];
        } else {
          _droppedBytes += _rxBuffer.length;
          _rxBuffer.clear();
        }
        break;
      }

      if (headerIdx > 0) {
        _droppedBytes += headerIdx;
        _rxBuffer.removeRange(0, headerIdx);
      }

      if (_rxBuffer.length < 14) {
        break;
      }

      final frame = _rxBuffer.sublist(0, 14);
      _rxBuffer.removeRange(0, 14);
      _processFrame(frame);
    }
  }

  void _processFrame(List<int> frame) {
    _receivedFrames++;
    _fpsCounter++;

    // Parse bytes
    // Frame layout: 22 00 | gyroX | gyroY | gyroZ | accelX | accelY | accelZ
    // Each 16-bit little endian signed integer
    final rawGx = _readInt16LE(frame, 2);
    final rawGy = _readInt16LE(frame, 4);
    final rawGz = _readInt16LE(frame, 6);
    final rawAx = _readInt16LE(frame, 8);
    final rawAy = _readInt16LE(frame, 10);
    final rawAz = _readInt16LE(frame, 12);

    // Scaling
    final gx = rawGx / 131.0 - _offsetX;
    final gy = rawGy / 131.0 - _offsetY;
    final gz = rawGz / 131.0 - _offsetZ;

    final ax = rawAx / 2048.0;
    final ay = rawAy / 2048.0;
    final az = rawAz / 2048.0;

    setState(() {
      _gyroX = gx;
      _gyroY = gy;
      _gyroZ = gz;
      _accelX = ax;
      _accelY = ay;
      _accelZ = az;
    });

    // Acceleration-based Tap-to-Click detection (Z axis shock)
    if (_accelTapClick) {
      double diffZ = (az - _lastAccelZ).abs();
      if (diffZ > 0.8) { // Shock threshold
        final now = DateTime.now();
        if (now.difference(_lastClickTime).inMilliseconds > 400) {
          _lastClickTime = now;
          _triggerSystemClick();
        }
      }
      _lastAccelZ = az;
    }

    // Air Mouse movement
    if (_mouseEnabled && _isAccessibilityServiceRunning) {
      // Rotate left/right (Yaw / gz) -> Move mouse X
      // Tilt up/down (Pitch / gx) -> Move mouse Y
      double dx = -gz * _sensitivityX;
      double dy = gx * _sensitivityY;

      // Apply deadzone
      if (dx.abs() < _deadzone) dx = 0;
      if (dy.abs() < _deadzone) dy = 0;

      if (dx != 0 || dy != 0) {
        _mouseChannel.invokeMethod('moveCursor', {'dx': dx, 'dy': dy});
      }
    }
  }

  int _readInt16LE(List<int> bytes, int offset) {
    int val = bytes[offset] | (bytes[offset + 1] << 8);
    if (val & 0x8000 != 0) {
      val = val - 0x10000;
    }
    return val;
  }

  void _triggerSystemClick() {
    if (_isAccessibilityServiceRunning) {
      _mouseChannel.invokeMethod('click');
    }
  }

  void _calibrateZero() async {
    setState(() {
      // In a real calibrate, we read current raw values and subtract them as offset
      // Since we already scaled, let's add the scaled values to offset
      _offsetX += _gyroX;
      _offsetY += _gyroY;
      _offsetZ += _gyroZ;
    });
    await _saveSetting('offset_x', _offsetX);
    await _saveSetting('offset_y', _offsetY);
    await _saveSetting('offset_z', _offsetZ);
    _showSnackBar("Wykalibrowano pozycję ZERO! 🎯");
  }

  void _resetOffsets() async {
    setState(() {
      _offsetX = 0.0;
      _offsetY = 0.0;
      _offsetZ = 0.0;
    });
    await _saveSetting('offset_x', 0.0);
    await _saveSetting('offset_y', 0.0);
    await _saveSetting('offset_z', 0.0);
    _showSnackBar("Reset offsets zakończony!");
  }

  void _disconnect() async {
    if (_connectedDevice != null) {
      try {
        await _connectedDevice!.disconnect();
      } catch (_) {}
    }
    _cleanupConnection();
  }

  void _cleanupConnection() {
    _txSub?.cancel();
    _txSub = null;
    _rxChar = null;
    _txChar = null;
    _connectedDevice = null;
    _rxBuffer.clear();
    setState(() {
      _connectionState = BluetoothConnectionState.disconnected;
    });
  }

  void _showSnackBar(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(msg),
        duration: const Duration(seconds: 2),
        backgroundColor: const Color(0xFF1E293B),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final bool isConnected = _connectionState == BluetoothConnectionState.connected;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Triki Mouse Dashboard 🐾', style: TextStyle(fontWeight: FontWeight.bold)),
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_accessibility),
            tooltip: 'Ustawienia Dostępności',
            onPressed: () {
              _mouseChannel.invokeMethod('openAccessibilitySettings');
            },
          ),
          if (isConnected)
            IconButton(
              icon: const Icon(Icons.link_off, color: Colors.red),
              onPressed: _disconnect,
            )
        ],
      ),
      body: Container(
        decoration: const BoxDecoration(
          gradient: RadialGradient(
            colors: [Color(0xFF142017), Color(0xFF0A0C10)],
            center: Alignment.topCenter,
            radius: 1.2,
          ),
        ),
        child: SingleChildScrollView(
          padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              // Device status card
              _buildGlassPanel(
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              isConnected ? 'Połączono z Triki' : 'Brak połączenia',
                              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                            ),
                            Text(
                              isConnected 
                                  ? 'ID: ${_connectedDevice?.remoteId}' 
                                  : 'Wyszukaj i sparuj kapsel',
                              style: TextStyle(color: Colors.grey[400], fontSize: 13),
                            ),
                          ],
                        ),
                        _buildStatusIndicator(),
                      ],
                    ),
                    const SizedBox(height: 16),
                    if (!isConnected) ...[
                      ElevatedButton.icon(
                        style: ElevatedButton.styleFrom(
                          backgroundColor: const Color(0xFF22C55E),
                          foregroundColor: Colors.white,
                          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(100)),
                          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 24),
                        ),
                        icon: _isScanning 
                            ? const SizedBox(
                                width: 20, 
                                height: 20, 
                                child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)
                              )
                            : const Icon(Icons.bluetooth_searching),
                        label: Text(_isScanning ? 'Wyszukiwanie...' : 'Skanuj i Połącz z Triki'),
                        onPressed: _isScanning ? _stopScan : _startScan,
                      ),
                      if (_scanResults.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        Container(
                          constraints: const BoxConstraints(maxHeight: 150),
                          decoration: BoxDecoration(
                            color: Colors.black.withOpacity(0.3),
                            borderRadius: BorderRadius.circular(12),
                          ),
                          child: ListView.builder(
                            shrinkWrap: true,
                            itemCount: _scanResults.length,
                            itemBuilder: (context, idx) {
                              final r = _scanResults[idx];
                              final name = r.device.platformName.isNotEmpty 
                                  ? r.device.platformName 
                                  : "Nieznane urządzenie";
                              final isTriki = name.toLowerCase().contains("triki");
                              return ListTile(
                                leading: Icon(Icons.bluetooth, color: isTriki ? const Color(0xFF22C55E) : Colors.grey),
                                title: Text(name),
                                subtitle: Text(r.device.remoteId.str),
                                trailing: ElevatedButton(
                                  style: ElevatedButton.styleFrom(
                                    backgroundColor: isTriki ? const Color(0xFF22C55E) : Colors.blueGrey,
                                  ),
                                  onPressed: () => _connectToDevice(r.device),
                                  child: const Text('Połącz'),
                                ),
                              );
                            },
                          ),
                        ),
                      ],
                    ] else ...[
                      Row(
                        children: [
                          Expanded(
                            child: _buildValueCard('Sample Rate', '${_sampleRate.toStringAsFixed(0)} Hz'),
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: _buildValueCard('Ramki', '$_receivedFrames'),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // Service Status Panel
              _buildGlassPanel(
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text(
                            'Usługa Myszki (Accessibility)',
                            style: TextStyle(fontWeight: FontWeight.bold),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _isAccessibilityServiceRunning 
                                ? 'Włączona - Kursor aktywny' 
                                : 'Wyłączona - Kliknij ikonę u góry, by włączyć',
                            style: TextStyle(
                              color: _isAccessibilityServiceRunning ? const Color(0xFF22C55E) : Colors.redAccent,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                    Switch(
                      value: _mouseEnabled,
                      activeColor: const Color(0xFF22C55E),
                      onChanged: (val) {
                        setState(() {
                          _mouseEnabled = val;
                        });
                        _saveSetting('mouse_enabled', val);
                      },
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // Sensor visualization panel (Live readings)
              _buildGlassPanel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Sensory w Czasie Rzeczywistym', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    const SizedBox(height: 12),
                    _buildSensorBar('Gyro X (Pitch)', _gyroX, -250, 250, Colors.redAccent),
                    _buildSensorBar('Gyro Y (Roll)', _gyroY, -250, 250, Colors.greenAccent),
                    _buildSensorBar('Gyro Z (Yaw)', _gyroZ, -250, 250, Colors.blueAccent),
                    const Divider(height: 24, color: Colors.white12),
                    _buildSensorBar('Accel X', _accelX, -2.0, 2.0, Colors.orangeAccent),
                    _buildSensorBar('Accel Y', _accelY, -2.0, 2.0, Colors.pinkAccent),
                    _buildSensorBar('Accel Z', _accelZ, -2.0, 2.0, Colors.purpleAccent),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              // Configuration settings panel
              _buildGlassPanel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Ustawienia i Kalibracja', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    const SizedBox(height: 12),
                    
                    _buildSlider(
                      title: 'Czułość osi X (Poziomo)',
                      val: _sensitivityX,
                      min: 0.1,
                      max: 4.0,
                      onChanged: (v) {
                        setState(() => _sensitivityX = v);
                        _saveSetting('sensitivity_x', v);
                      },
                    ),
                    
                    _buildSlider(
                      title: 'Czułość osi Y (Pionowo)',
                      val: _sensitivityY,
                      min: 0.1,
                      max: 4.0,
                      onChanged: (v) {
                        setState(() => _sensitivityY = v);
                        _saveSetting('sensitivity_y', v);
                      },
                    ),

                    _buildSlider(
                      title: 'Martwa strefa (Deadzone)',
                      val: _deadzone,
                      min: 0.0,
                      max: 0.8,
                      onChanged: (v) {
                        setState(() => _deadzone = v);
                        _saveSetting('deadzone', v);
                      },
                    ),

                    const Divider(height: 24, color: Colors.white12),

                    // Toggles
                    SwitchListTile(
                      title: const Text('Kliknięcie stuknięciem (Z-Shock)', style: TextStyle(fontSize: 14)),
                      subtitle: const Text('Mocne puknięcie w kapsel działa jak kliknięcie', style: TextStyle(fontSize: 11)),
                      value: _accelTapClick,
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      onChanged: (val) {
                        setState(() => _accelTapClick = val);
                        _saveSetting('accel_tap_click', val);
                      },
                    ),

                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton.icon(
                            style: OutlinedButton.styleFrom(
                              side: const BorderSide(color: Color(0xFF3B82F6)),
                              foregroundColor: const Color(0xFF3B82F6),
                            ),
                            icon: const Icon(Icons.center_focus_strong),
                            label: const Text('Zatwierdź Zero (Tare)'),
                            onPressed: isConnected ? _calibrateZero : null,
                          ),
                        ),
                        const SizedBox(width: 12),
                        OutlinedButton(
                          onPressed: isConnected ? _resetOffsets : null,
                          child: const Text('Resetuj'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildGlassPanel({required Widget child}) {
    return Container(
      padding: const EdgeInsets.all(16.0),
      decoration: BoxDecoration(
        color: const Color(0xFF12161E).withOpacity(0.75),
        border: Border.all(color: Colors.white.withOpacity(0.08)),
        borderRadius: BorderRadius.circular(24),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.4),
            blurRadius: 32,
            offset: const Offset(0, 8),
          ),
        ],
      ),
      child: child,
    );
  }

  Widget _buildStatusIndicator() {
    Color c = Colors.grey;
    String txt = 'Rozłączony';

    switch (_connectionState) {
      case BluetoothConnectionState.connected:
        c = const Color(0xFF22C55E);
        txt = 'Połączono';
        break;
      case BluetoothConnectionState.connecting:
        c = Colors.amber;
        txt = 'Łączenie';
        break;
      default:
        break;
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: c.withOpacity(0.15),
        border: Border.all(color: c.withOpacity(0.4)),
        borderRadius: BorderRadius.circular(100),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            width: 8,
            height: 8,
            decoration: BoxDecoration(color: c, shape: BoxShape.circle),
          ),
          const SizedBox(width: 6),
          Text(txt, style: TextStyle(color: c, fontSize: 12, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildValueCard(String label, String value) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white.withOpacity(0.02),
        border: Border.all(color: Colors.white.withOpacity(0.04)),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        children: [
          Text(label, style: const TextStyle(fontSize: 11, color: Colors.grey)),
          const SizedBox(height: 4),
          Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, fontFamily: 'monospace')),
        ],
      ),
    );
  }

  Widget _buildSensorBar(String label, double val, double minVal, double maxVal, Color c) {
    double progress = (val - minVal) / (maxVal - minVal);
    progress = progress.clamp(0.0, 1.0);
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(label, style: const TextStyle(fontSize: 12, color: Colors.grey)),
              Text(val.toStringAsFixed(2), style: const TextStyle(fontSize: 12, fontFamily: 'monospace', fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 4),
          ClipRRect(
            borderRadius: BorderRadius.circular(100),
            child: LinearProgressIndicator(
              value: progress,
              backgroundColor: Colors.white.withOpacity(0.05),
              valueColor: AlwaysStoppedAnimation<Color>(c),
              minHeight: 6,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSlider({
    required String title,
    required double val,
    required double min,
    required double max,
    required ValueChanged<double> onChanged,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(title, style: const TextStyle(fontSize: 13, color: Colors.grey)),
              Text(val.toStringAsFixed(2), style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold, fontFamily: 'monospace')),
            ],
          ),
          SliderTheme(
            data: SliderTheme.of(context).copyWith(
              activeTrackColor: const Color(0xFF22C55E),
              thumbColor: const Color(0xFF22C55E),
              inactiveTrackColor: Colors.white10,
            ),
            child: Slider(
              value: val,
              min: min,
              max: max,
              onChanged: onChanged,
            ),
          ),
        ],
      ),
    );
  }
}
