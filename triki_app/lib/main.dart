import 'dart:async';
import 'dart:convert';
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
      title: 'Triki-myszka',
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

enum MouseMode { air, table }
enum ButtonOrientation { left, front, right }

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

  // Saved settings
  String? _savedDeviceId;
  String? _savedDeviceName;
  double _sensitivityX = 1.2;
  double _sensitivityY = 1.2;
  double _deadzone = 0.15;
  bool _mouseEnabled = true;
  bool _accelTapClick = false; 
  bool _physicalButtonClick = true; 

  // Mouse Mode & Orientation
  MouseMode _mouseMode = MouseMode.air;
  ButtonOrientation _buttonOrientation = ButtonOrientation.left;

  // Calibration Offsets (Tare values)
  double _offsetX = 0.0;
  double _offsetY = 0.0;
  double _offsetZ = 0.0;
  double _accelOffsetX = 0.0;
  double _accelOffsetY = 0.0;

  // Telemetry state
  double _gyroX = 0.0, _gyroY = 0.0, _gyroZ = 0.0;
  double _accelX = 0.0, _accelY = 0.0, _accelZ = 0.0;
  int _receivedFrames = 0;
  int _droppedBytes = 0;
  double _sampleRate = 0.0;
  Timer? _fpsTimer;
  int _fpsCounter = 0;

  // Velocity integration for Table Mouse
  double _velocityX = 0.0;
  double _velocityY = 0.0;

  // Button state variables
  bool _isButtonPressed = false;

  // Accessibility service status
  bool _isAccessibilityServiceRunning = false;
  Timer? _serviceCheckTimer;

  // Buffer for NUS packets
  List<int> _rxBuffer = [];

  // Shock Tap Click variables
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

    _fpsTimer = Timer.periodic(const Duration(seconds: 1), (timer) {
      setState(() {
        _sampleRate = _fpsCounter.toDouble();
        _fpsCounter = 0;
      });
    });

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
      _savedDeviceName = prefs.getString('saved_device_name');
      _sensitivityX = prefs.getDouble('sensitivity_x') ?? 1.2;
      _sensitivityY = prefs.getDouble('sensitivity_y') ?? 1.2;
      _deadzone = prefs.getDouble('deadzone') ?? 0.15;
      _mouseEnabled = prefs.getBool('mouse_enabled') ?? true;
      _accelTapClick = prefs.getBool('accel_tap_click') ?? false;
      _physicalButtonClick = prefs.getBool('physical_button_click') ?? true;
      _mouseMode = MouseMode.values[prefs.getInt('mouse_mode') ?? 0];
      _buttonOrientation = ButtonOrientation.values[prefs.getInt('button_orientation') ?? 0];
      _offsetX = prefs.getDouble('offset_x') ?? 0.0;
      _offsetY = prefs.getDouble('offset_y') ?? 0.0;
      _offsetZ = prefs.getDouble('offset_z') ?? 0.0;
      _accelOffsetX = prefs.getDouble('accel_offset_x') ?? 0.0;
      _accelOffsetY = prefs.getDouble('accel_offset_y') ?? 0.0;
    });

    if (_savedDeviceId != null) {
      // Run connection in background so it doesn't block UI initialize
      WidgetsBinding.instance.addPostFrameCallback((_) {
        _connectToSavedDevice();
      });
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
    } else if (value is int) {
      await prefs.setInt(key, value);
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

  void _connectToSavedDevice() async {
    if (_savedDeviceId == null) return;
    _showSnackBar("Oczekiwanie na włączenie zapisanego kapsla... 🐾");
    
    setState(() {
      _connectionState = BluetoothConnectionState.connecting;
    });

    try {
      final device = BluetoothDevice.fromId(_savedDeviceId!);
      _connectedDevice = device;

      _connStateSub = device.connectionState.listen((state) {
        setState(() {
          _connectionState = state;
        });
        if (state == BluetoothConnectionState.connected) {
          _discoverServices(device);
        } else if (state == BluetoothConnectionState.disconnected) {
          _cleanupConnection();
          _connectToSavedDevice();
        }
      });

      await device.connect(autoConnect: true);
    } catch (e) {
      setState(() {
        _connectionState = BluetoothConnectionState.disconnected;
      });
      _showSnackBar("Nie udało się połączyć z zapisanym urządzeniem: $e");
    }
  }

  Future<void> _connectToDevice(BluetoothDevice device) async {
    _stopScan();
    setState(() {
      _connectionState = BluetoothConnectionState.connecting;
    });

    try {
      await device.connect(autoConnect: false).timeout(const Duration(seconds: 8));
      _connectedDevice = device;
      
      final name = device.platformName.isNotEmpty ? device.platformName : "Triki Kapsel";
      await _saveSetting('saved_device_id', device.remoteId.str);
      await _saveSetting('saved_device_name', name);
      
      setState(() {
        _savedDeviceId = device.remoteId.str;
        _savedDeviceName = name;
      });

      _connStateSub = device.connectionState.listen((state) {
        setState(() {
          _connectionState = state;
        });
        if (state == BluetoothConnectionState.connected) {
          _discoverServices(device);
        } else if (state == BluetoothConnectionState.disconnected) {
          _cleanupConnection();
          _connectToSavedDevice();
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

  Future<void> _forgetSavedDevice() async {
    _disconnect();
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove('saved_device_id');
    await prefs.remove('saved_device_name');
    setState(() {
      _savedDeviceId = null;
      _savedDeviceName = null;
    });
    _showSnackBar("Zapomniano zapisane urządzenie!");
  }

  // Renames the capsule in the app, and optionally attempts to write to the BLE Generic Access Service (0x1800 -> 0x2A00)
  Future<void> _renameCapsule(String newName) async {
    if (newName.trim().isEmpty) return;
    
    // 1. Save custom nickname locally in App SharedPreferences
    await _saveSetting('saved_device_name', newName);
    setState(() {
      _savedDeviceName = newName;
    });

    bool hardwareSuccess = false;

    // 2. Try to update hardware BLE name if connected
    if (_connectedDevice != null && _connectionState == BluetoothConnectionState.connected) {
      try {
        List<BluetoothService> services = await _connectedDevice!.discoverServices();
        const genericAccessUuid = "1800";
        const deviceNameUuid = "2a00";

        BluetoothService? accessService;
        for (var s in services) {
          if (s.uuid.toString().toLowerCase().contains(genericAccessUuid)) {
            accessService = s;
            break;
          }
        }

        if (accessService != null) {
          for (var c in accessService.characteristics) {
            if (c.uuid.toString().toLowerCase().contains(deviceNameUuid)) {
              // Write new name bytes
              await c.write(utf8.encode(newName), timeout: 5);
              hardwareSuccess = true;
              break;
            }
          }
        }
      } catch (e) {
        debugPrint("Hardware device name update failed (probably read-only): $e");
      }
    }

    if (hardwareSuccess) {
      _showSnackBar("Zmieniono nazwę w aplikacji oraz w pamięci kapsla! 🔴✨");
    } else {
      _showSnackBar("Zmieniono nazwę lokalną w aplikacji! 🐾");
    }
  }

  void _showRenameDialog() {
    final controller = TextEditingController(text: _savedDeviceName ?? "Triki");
    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF12161E),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: const Text("Zmień nazwę kapsla", style: TextStyle(fontWeight: FontWeight.bold)),
          content: TextField(
            controller: controller,
            decoration: const InputDecoration(
              hintText: "Wpisz nową nazwę",
              enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: Colors.white30)),
              focusedBorder: UnderlineInputBorder(borderSide: BorderSide(color: Color(0xFF22C55E))),
            ),
            autofocus: true,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text("ANULUJ", style: TextStyle(color: Colors.grey)),
            ),
            TextButton(
              onPressed: () {
                _renameCapsule(controller.text);
                Navigator.of(context).pop();
              },
              child: const Text("ZAPISZ", style: TextStyle(color: Color(0xFF22C55E), fontWeight: FontWeight.bold)),
            ),
          ],
        );
      },
    );
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
        _showSnackBar("Brak charakterystyk RX/TX!");
        _disconnect();
        return;
      }

      await _txChar!.setNotifyValue(true);
      _txSub = _txChar!.lastValueStream.listen((data) {
        _handleRawBytes(data);
      });

      final startCmd = [0x20, 0x10, 0x00, 0xD0, 0x07, 0x68, 0x00, 0x03];
      await _rxChar!.write(startCmd, withoutResponse: true);

      _showSnackBar("Połączono z Triki i uruchomiono mysz! 🐾");
    } catch (e) {
      _showSnackBar("Błąd konfiguracji BLE: $e");
      _disconnect();
    }
  }

  void _handleRawBytes(List<int> data) {
    _rxBuffer.addAll(data);

    while (_rxBuffer.length >= 14) {
      int headerIdx = -1;
      for (int i = 0; i < _rxBuffer.length - 1; i++) {
        if (_rxBuffer[i] == 0x22) {
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

    final btnState = frame[1];
    final rawGx = _readInt16LE(frame, 2);
    final rawGy = _readInt16LE(frame, 4);
    final rawGz = _readInt16LE(frame, 6);
    final rawAx = _readInt16LE(frame, 8);
    final rawAy = _readInt16LE(frame, 10);
    final rawAz = _readInt16LE(frame, 12);

    double gx = rawGx / 131.0 - _offsetX;
    double gy = rawGy / 131.0 - _offsetY;
    double gz = rawGz / 131.0 - _offsetZ;

    double ax = rawAx / 2048.0 - _accelOffsetX;
    double ay = rawAy / 2048.0 - _accelOffsetY;
    double az = rawAz / 2048.0;

    if (_physicalButtonClick) {
      bool pressed = btnState != 0x00;
      if (pressed && !_isButtonPressed) {
        _isButtonPressed = true;
        _triggerSystemClick();
      } else if (!pressed && _isButtonPressed) {
        _isButtonPressed = false;
      }
    }

    setState(() {
      _gyroX = gx;
      _gyroY = gy;
      _gyroZ = gz;
      _accelX = ax;
      _accelY = ay;
      _accelZ = az;
    });

    if (_accelTapClick) {
      double diffZ = (az - _lastAccelZ).abs();
      if (diffZ > 0.9) {
        final now = DateTime.now();
        if (now.difference(_lastClickTime).inMilliseconds > 450) {
          _lastClickTime = now;
          _triggerSystemClick();
        }
      }
      _lastAccelZ = az;
    }

    double inputGx = gx;
    double inputGz = gz;
    double inputAx = ax;
    double inputAy = ay;

    if (_buttonOrientation == ButtonOrientation.front) {
      inputGx = gy;
      inputGz = -gx;
      inputAx = ay;
      inputAy = -ax;
    } else if (_buttonOrientation == ButtonOrientation.right) {
      inputGx = -gx;
      inputGz = -gz;
      inputAx = -ax;
      inputAy = -ay;
    }

    if (_mouseEnabled && _isAccessibilityServiceRunning) {
      double dx = 0.0;
      double dy = 0.0;

      if (_mouseMode == MouseMode.air) {
        dx = -inputGz * _sensitivityX;
        dy = inputGx * _sensitivityY;

        if (dx.abs() < _deadzone) dx = 0;
        if (dy.abs() < _deadzone) dy = 0;

        if (dx != 0 || dy != 0) {
          _mouseChannel.invokeMethod('moveCursor', {'dx': dx, 'dy': dy});
        }
      } else {
        double accThreshold = 0.08;
        double inputX = inputAx;
        double inputY = inputAy;

        if (inputX.abs() < accThreshold) inputX = 0.0;
        if (inputY.abs() < accThreshold) inputY = 0.0;

        const friction = 0.82;

        _velocityX = (_velocityX + inputX * 9.81 * 0.02) * friction;
        _velocityY = (_velocityY - inputY * 9.81 * 0.02) * friction; 

        dx = _velocityX * _sensitivityX * 25.0;
        dy = _velocityY * _sensitivityY * 25.0;

        if (dx.abs() > 0.1 || dy.abs() > 0.1) {
          _mouseChannel.invokeMethod('moveCursor', {'dx': dx, 'dy': dy});
        }
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
      _offsetX += _gyroX;
      _offsetY += _gyroY;
      _offsetZ += _gyroZ;
      _accelOffsetX += _accelX;
      _accelOffsetY += _accelY;
      _velocityX = 0.0;
      _velocityY = 0.0;
    });
    await _saveSetting('offset_x', _offsetX);
    await _saveSetting('offset_y', _offsetY);
    await _saveSetting('offset_z', _offsetZ);
    await _saveSetting('accel_offset_x', _accelOffsetX);
    await _saveSetting('accel_offset_y', _accelOffsetY);
  }

  void _resetOffsets() async {
    setState(() {
      _offsetX = 0.0;
      _offsetY = 0.0;
      _offsetZ = 0.0;
      _accelOffsetX = 0.0;
      _accelOffsetY = 0.0;
      _velocityX = 0.0;
      _velocityY = 0.0;
    });
    await _saveSetting('offset_x', 0.0);
    await _saveSetting('offset_y', 0.0);
    await _saveSetting('offset_z', 0.0);
    await _saveSetting('accel_offset_x', 0.0);
    await _saveSetting('accel_offset_y', 0.0);
    _showSnackBar("Wyczyszczono offsety!");
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
        duration: const Duration(seconds: 3),
        backgroundColor: const Color(0xFF1E293B),
        behavior: SnackBarBehavior.floating,
      ),
    );
  }

  void _startCalibrationWizard() {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (BuildContext context) {
        return CalibrationWizardSheet(
          initialMode: _mouseMode,
          initialOrientation: _buttonOrientation,
          onFinish: (mode, orientation) {
            setState(() {
              _mouseMode = mode;
              _buttonOrientation = orientation;
            });
            _saveSetting('mouse_mode', mode.index);
            _saveSetting('button_orientation', orientation.index);
            _calibrateZero();
            _showSnackBar("Zapisano ustawienia i wykalibrowano! 🎯");
          },
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final bool isConnected = _connectionState == BluetoothConnectionState.connected;
    final bool isConnecting = _connectionState == BluetoothConnectionState.connecting;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Triki-myszka Dashboard 🐾', style: TextStyle(fontWeight: FontWeight.bold)),
        backgroundColor: Colors.transparent,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.settings_accessibility),
            tooltip: 'Usługa Dostępności',
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
              _buildGlassPanel(
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                isConnected 
                                    ? 'Połączono z Triki' 
                                    : (isConnecting ? 'Oczekiwanie na kapsel...' : 'Brak połączenia'),
                                style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                              ),
                              const SizedBox(height: 2),
                              if (_savedDeviceId != null) ...[
                                Row(
                                  children: [
                                    const Icon(Icons.bookmark, color: Color(0xFF22C55E), size: 14),
                                    const SizedBox(width: 4),
                                    Expanded(
                                      child: Row(
                                        children: [
                                          Expanded(
                                            child: Text(
                                              'Zapisany: ${_savedDeviceName ?? "Kapsel"} (${_savedDeviceId!.substring(0, min(17, _savedDeviceId!.length))})',
                                              style: TextStyle(color: Colors.grey[400], fontSize: 12),
                                              overflow: TextOverflow.ellipsis,
                                            ),
                                          ),
                                          IconButton(
                                            icon: const Icon(Icons.edit, color: Colors.blueAccent, size: 16),
                                            padding: EdgeInsets.zero,
                                            constraints: const BoxConstraints(),
                                            onPressed: _showRenameDialog,
                                            tooltip: "Zmień nazwę",
                                          ),
                                        ],
                                      ),
                                    ),
                                  ],
                                ),
                              ] else ...[
                                Text(
                                  'Wyszukaj i sparuj kapsel',
                                  style: TextStyle(color: Colors.grey[400], fontSize: 13),
                                ),
                              ],
                            ],
                          ),
                        ),
                        const SizedBox(width: 8),
                        _buildStatusIndicator(),
                      ],
                    ),
                    const SizedBox(height: 16),
                    if (!isConnected) ...[
                      Row(
                        children: [
                          Expanded(
                            child: ElevatedButton.icon(
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF22C55E),
                                foregroundColor: Colors.white,
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(100)),
                                padding: const EdgeInsets.symmetric(vertical: 12),
                              ),
                              icon: _isScanning 
                                  ? const SizedBox(
                                      width: 20, 
                                      height: 20, 
                                      child: CircularProgressIndicator(color: Colors.white, strokeWidth: 2)
                                    )
                                  : const Icon(Icons.bluetooth_searching),
                              label: Text(_isScanning ? 'Szukanie...' : 'Wyszukaj Kapsel'),
                              onPressed: _isScanning ? _stopScan : _startScan,
                            ),
                          ),
                          if (_savedDeviceId != null) ...[
                            const SizedBox(width: 12),
                            OutlinedButton.icon(
                              style: OutlinedButton.styleFrom(
                                side: const BorderSide(color: Colors.redAccent),
                                foregroundColor: Colors.redAccent,
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(100)),
                                padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                              ),
                              icon: const Icon(Icons.bookmark_remove),
                              label: const Text('Zapomnij'),
                              onPressed: _forgetSavedDevice,
                            ),
                          ],
                        ],
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
                            child: _buildValueCard('Myszka', _mouseMode == MouseMode.air ? 'Powietrzna' : 'Stołowa'),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 16),

              ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF3B82F6),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
                icon: const Icon(Icons.auto_awesome),
                label: const Text('Uruchom Kreator Kalibracji i Trybu', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                onPressed: _startCalibrationWizard,
              ),
              const SizedBox(height: 16),

              _buildGlassPanel(
                child: Column(
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              const Text(
                                'Sterowanie systemowe (Mysz)',
                                style: TextStyle(fontWeight: FontWeight.bold),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                _isAccessibilityServiceRunning 
                                    ? 'Kursor aktywny na ekranie' 
                                    : 'Brak uprawnień dostępności',
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
                    const Divider(height: 24, color: Colors.white12),
                    SwitchListTile(
                      title: const Text('Obsługa fizycznego przycisku', style: TextStyle(fontSize: 14)),
                      subtitle: const Text('Kliknięcie przycisku na kapslu działa jak klik na telefonie', style: TextStyle(fontSize: 11)),
                      value: _physicalButtonClick,
                      activeColor: const Color(0xFF22C55E),
                      dense: true,
                      contentPadding: EdgeInsets.zero,
                      onChanged: (val) {
                        setState(() {
                          _physicalButtonClick = val;
                        });
                        _saveSetting('physical_button_click', val);
                      },
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),

              _buildGlassPanel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Odczyty telemetryczne', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    const SizedBox(height: 12),
                    _buildSensorBar('Żyroskop X (Pitch)', _gyroX, -200, 200, Colors.redAccent),
                    _buildSensorBar('Żyroskop Z (Yaw)', _gyroZ, -200, 200, Colors.blueAccent),
                    const Divider(height: 20, color: Colors.white12),
                    _buildSensorBar('Akcelerometr X', _accelX, -1.5, 1.5, Colors.orangeAccent),
                    _buildSensorBar('Akcelerometr Y', _accelY, -1.5, 1.5, Colors.pinkAccent),
                    _buildSensorBar('Akcelerometr Z', _accelZ, -1.5, 1.5, Colors.purpleAccent),
                    if (_mouseMode == MouseMode.table) ...[
                      const Divider(height: 20, color: Colors.white12),
                      _buildSensorBar('Lokalna prędkość X', _velocityX, -1.0, 1.0, Colors.tealAccent),
                      _buildSensorBar('Lokalna prędkość Y', _velocityY, -1.0, 1.0, Colors.tealAccent),
                    ]
                  ],
                ),
              ),
              const SizedBox(height: 16),

              _buildGlassPanel(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Dostrajanie czułości', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                    const SizedBox(height: 12),
                    _buildSlider(
                      title: 'Czułość osi X',
                      val: _sensitivityX,
                      min: 0.1,
                      max: 4.0,
                      onChanged: (v) {
                        setState(() => _sensitivityX = v);
                        _saveSetting('sensitivity_x', v);
                      },
                    ),
                    _buildSlider(
                      title: 'Czułość osi Y',
                      val: _sensitivityY,
                      min: 0.1,
                      max: 4.0,
                      onChanged: (v) {
                        setState(() => _sensitivityY = v);
                        _saveSetting('sensitivity_y', v);
                      },
                    ),
                    if (_mouseMode == MouseMode.air)
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
          Text(value, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, fontFamily: 'monospace')),
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

class CalibrationWizardSheet extends StatefulWidget {
  final MouseMode initialMode;
  final ButtonOrientation initialOrientation;
  final Function(MouseMode, ButtonOrientation) onFinish;

  const CalibrationWizardSheet({
    super.key,
    required this.initialMode,
    required this.initialOrientation,
    required this.onFinish,
  });

  @override
  State<CalibrationWizardSheet> createState() => _CalibrationWizardSheetState();
}

class _CalibrationWizardSheetState extends State<CalibrationWizardSheet> {
  final PageController _pageController = PageController();
  int _currentStep = 0;

  late MouseMode _mode;
  late ButtonOrientation _orientation;
  
  bool _calibrating = false;
  double _calibrationProgress = 0.0;
  Timer? _calibrationTimer;

  @override
  void initState() {
    super.initState();
    _mode = widget.initialMode;
    _orientation = widget.initialOrientation;
  }

  @override
  void dispose() {
    _calibrationTimer?.cancel();
    _pageController.dispose();
    super.dispose();
  }

  void _nextStep() {
    if (_currentStep < 3) {
      _pageController.nextPage(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    } else {
      widget.onFinish(_mode, _orientation);
      Navigator.of(context).pop();
    }
  }

  void _prevStep() {
    if (_currentStep > 0) {
      _pageController.previousPage(
        duration: const Duration(milliseconds: 300),
        curve: Curves.easeInOut,
      );
    }
  }

  void _runCalibration() {
    setState(() {
      _calibrating = true;
      _calibrationProgress = 0.0;
    });

    _calibrationTimer = Timer.periodic(const Duration(milliseconds: 50), (timer) {
      setState(() {
        _calibrationProgress += 0.05;
        if (_calibrationProgress >= 1.0) {
          _calibrationProgress = 1.0;
          _calibrating = false;
          _calibrationTimer?.cancel();
          _nextStep();
        }
      });
    });
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      height: MediaQuery.of(context).size.height * 0.75,
      decoration: const BoxDecoration(
        color: Color(0xFF0F131A),
        borderRadius: BorderRadius.only(
          topLeft: Radius.circular(32),
          topRight: Radius.circular(32),
        ),
      ),
      child: Column(
        children: [
          const SizedBox(height: 12),
          Container(
            width: 40,
            height: 4,
            decoration: BoxDecoration(
              color: Colors.white38,
              borderRadius: BorderRadius.circular(100),
            ),
          ),
          const SizedBox(height: 16),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24.0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text(
                  'Konfiguracja Kapsla Triki',
                  style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18),
                ),
                Text(
                  'Krok ${_currentStep + 1} z 4',
                  style: const TextStyle(color: Colors.grey, fontSize: 13),
                ),
              ],
            ),
          ),
          const SizedBox(height: 12),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 24.0),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(100),
              child: LinearProgressIndicator(
                value: (_currentStep + 1) / 4,
                minHeight: 4,
                backgroundColor: Colors.white.withOpacity(0.05),
                valueColor: const AlwaysStoppedAnimation<Color>(Color(0xFF22C55E)),
              ),
            ),
          ),
          Expanded(
            child: PageView(
              controller: _pageController,
              physics: const NeverScrollableScrollPhysics(),
              onPageChanged: (idx) {
                setState(() {
                  _currentStep = idx;
                });
              },
              children: [
                _buildModeSelectStep(),
                _buildOrientationSelectStep(),
                _buildCalibrationStep(),
                _buildFinishedStep(),
              ],
            ),
          ),
          _buildNavButtons(),
        ],
      ),
    );
  }

  Widget _buildModeSelectStep() {
    return Padding(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Jak chcesz używać kapsla?',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 8),
          const Text(
            'Wybierz tryb pracy dopasowany do Twoich potrzeb.',
            style: TextStyle(fontSize: 13, color: Colors.grey),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          Expanded(
            child: Row(
              children: [
                Expanded(
                  child: _buildModeCard(
                    mode: MouseMode.air,
                    title: 'Myszka Powietrzna',
                    description: 'Trzymaj kapsel w powietrzu i obracaj nim jak wskaźnikiem laserowym. Idealne do prezentacji i kanapy.',
                    icon: Icons.mouse,
                    color: const Color(0xFF22C55E),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: _buildModeCard(
                    mode: MouseMode.table,
                    title: 'Myszka Stołowa',
                    description: 'Połóż kapsel na stole i przesuwaj nim w wybranym kierunku. Działa jak standardowa myszka optyczna.',
                    icon: Icons.layers,
                    color: const Color(0xFF3B82F6),
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildModeCard({
    required MouseMode mode,
    required String title,
    required String description,
    required IconData icon,
    required Color color,
  }) {
    final bool isSelected = _mode == mode;
    return InkWell(
      onTap: () {
        setState(() {
          _mode = mode;
        });
      },
      borderRadius: BorderRadius.circular(24),
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 250),
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: isSelected ? color.withOpacity(0.08) : Colors.white.withOpacity(0.01),
          border: Border.all(
            color: isSelected ? color : Colors.white.withOpacity(0.08),
            width: isSelected ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(24),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: isSelected ? color.withOpacity(0.15) : Colors.white.withOpacity(0.04),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: color, size: 28),
            ),
            const SizedBox(height: 14),
            Text(title, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
            const SizedBox(height: 8),
            Text(
              description,
              style: const TextStyle(fontSize: 10, color: Colors.grey, height: 1.4),
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildOrientationSelectStep() {
    double angle = 0.0;
    if (_orientation == ButtonOrientation.left) {
      angle = -pi / 2;
    } else if (_orientation == ButtonOrientation.front) {
      angle = 0.0;
    } else if (_orientation == ButtonOrientation.right) {
      angle = pi / 2;
    }

    return Padding(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Text(
            'Ustawienie orientacji kapsla',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 6),
          const Text(
            'Wybierz kierunek, w którym fizycznie wskazuje czerwony przycisk na boku kapsla.',
            style: TextStyle(fontSize: 13, color: Colors.grey),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          Expanded(
            child: Center(
              child: TweenAnimationBuilder<double>(
                tween: Tween<double>(begin: angle, end: angle),
                duration: const Duration(milliseconds: 300),
                curve: Curves.easeOutBack,
                builder: (context, value, child) {
                  return Transform.rotate(
                    angle: value,
                    child: CustomPaint(
                      size: const Size(180, 180),
                      painter: InteractiveCap2DPainter(),
                    ),
                  );
                },
              ),
            ),
          ),
          const SizedBox(height: 16),
          Row(
            children: [
              Expanded(
                child: _buildOrientationButton(ButtonOrientation.left, 'W Lewo'),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _buildOrientationButton(ButtonOrientation.front, 'Do Mnie'),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: _buildOrientationButton(ButtonOrientation.right, 'W Prawo'),
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildOrientationButton(ButtonOrientation orientation, String label) {
    final bool isSelected = _orientation == orientation;
    return ChoiceChip(
      label: Container(
        width: double.infinity,
        alignment: Alignment.center,
        child: Text(label, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
      ),
      selected: isSelected,
      selectedColor: const Color(0xFF22C55E).withOpacity(0.2),
      backgroundColor: Colors.white.withOpacity(0.02),
      onSelected: (val) {
        if (val) {
          setState(() {
            _orientation = orientation;
          });
        }
      },
    );
  }

  Widget _buildCalibrationStep() {
    return Padding(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Text(
            'Kalibracja położenia początkowego',
            style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          const Text(
            'Połóż kapsel płasko na stabilnym podłożu. Upewnij się, że urządzenie nie drży.',
            style: TextStyle(fontSize: 12, color: Colors.grey),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 48),
          _calibrating 
              ? SizedBox(
                  width: 120,
                  height: 120,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      CircularProgressIndicator(
                        value: _calibrationProgress,
                        strokeWidth: 8,
                        color: const Color(0xFF22C55E),
                        backgroundColor: Colors.white.withOpacity(0.05),
                      ),
                      Text(
                        '${(_calibrationProgress * 100).toInt()}%',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20, fontFamily: 'monospace'),
                      ),
                    ],
                  ),
                )
              : ElevatedButton.icon(
                  style: ElevatedButton.styleFrom(
                    backgroundColor: const Color(0xFF22C55E),
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16, horizontal: 32),
                    shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(100)),
                  ),
                  icon: const Icon(Icons.center_focus_strong),
                  label: const Text('ROZPOCZNIJ KALIBRACJĘ', style: TextStyle(fontWeight: FontWeight.bold)),
                  onPressed: _runCalibration,
                ),
          const SizedBox(height: 24),
          if (_calibrating)
            const Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(strokeWidth: 1.5, color: Colors.grey),
                ),
                SizedBox(width: 10),
                Text('Uzgadnianie żyroskopu i akcelerometru...', style: TextStyle(fontSize: 12, color: Colors.grey)),
              ],
            )
        ],
      ),
    );
  }

  Widget _buildFinishedStep() {
    return const Padding(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.check_circle_outline, color: Color(0xFF22C55E), size: 80),
          SizedBox(height: 20),
          Text(
            'Konfiguracja ukończona!',
            style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
          ),
          SizedBox(height: 8),
          Text(
            'Twój kapsel Triki jest teraz gotowy do sterowania systemem. Wszystkie parametry zostały zapisane w pamięci.',
            style: TextStyle(fontSize: 13, color: Colors.grey),
            textAlign: TextAlign.center,
          ),
        ],
      ),
    );
  }

  Widget _buildNavButtons() {
    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 16.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          if (_currentStep > 0 && _currentStep < 3 && !_calibrating)
            TextButton(
              onPressed: _prevStep,
              child: const Text('WSTECZ', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
            )
          else
            const SizedBox(),
          if (_currentStep != 2) 
            ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: const Color(0xFF22C55E),
                padding: const EdgeInsets.symmetric(horizontal: 28, vertical: 12),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(100)),
              ),
              onPressed: _nextStep,
              child: Text(_currentStep == 3 ? 'GOTOWE' : 'DALEJ', style: const TextStyle(fontWeight: FontWeight.bold)),
            ),
        ],
      ),
    );
  }
}

class InteractiveCap2DPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final center = Offset(size.width / 2, size.height / 2);
    final outerRadius = size.width / 2.2;
    final innerRadius = outerRadius * 0.78;

    final capPaint = Paint()
      ..color = const Color(0xFF1E293B)
      ..style = PaintingStyle.fill;

    final borderPaint = Paint()
      ..color = Colors.white.withOpacity(0.2)
      ..strokeWidth = 3
      ..style = PaintingStyle.stroke;

    final innerCapPaint = Paint()
      ..color = const Color(0xFF0F172A)
      ..style = PaintingStyle.fill;

    final zappkaLabelPaint = Paint()
      ..color = const Color(0xFF22C55E)
      ..strokeWidth = 2
      ..style = PaintingStyle.fill;

    final ridgePaint = Paint()
      ..color = Colors.white.withOpacity(0.15)
      ..strokeWidth = 4
      ..strokeCap = StrokeCap.round;

    for (int i = 0; i < 24; i++) {
      double angle = (2 * pi * i) / 24;
      double rStart = innerRadius * 0.95;
      double rEnd = outerRadius * 1.05;
      
      canvas.drawLine(
        Offset(center.dx + rStart * cos(angle), center.dy + rStart * sin(angle)),
        Offset(center.dx + rEnd * cos(angle), center.dy + rEnd * sin(angle)),
        ridgePaint,
      );
    }

    canvas.drawCircle(center, outerRadius, capPaint);
    canvas.drawCircle(center, outerRadius, borderPaint);

    canvas.drawCircle(center, innerRadius, innerCapPaint);
    canvas.drawCircle(center, innerRadius, Paint()
      ..color = const Color(0xFF22C55E).withOpacity(0.08)
      ..style = PaintingStyle.fill);

    final logoPath = Path();
    logoPath.moveTo(center.dx - 18, center.dy - 18);
    logoPath.lineTo(center.dx + 18, center.dy - 18);
    logoPath.lineTo(center.dx - 18, center.dy + 18);
    logoPath.lineTo(center.dx + 18, center.dy + 18);
    logoPath.lineTo(center.dx + 10, center.dy + 18);
    logoPath.lineTo(center.dx - 18, center.dy + 18);
    logoPath.close();
    canvas.drawPath(logoPath, zappkaLabelPaint);

    final buttonPaint = Paint()
      ..color = const Color(0xFFEF4444)
      ..style = PaintingStyle.fill;

    final buttonGlowPaint = Paint()
      ..color = const Color(0xFFEF4444).withOpacity(0.4)
      ..maskFilter = const MaskFilter.blur(BlurStyle.normal, 6);

    final buttonCenter = Offset(center.dx + outerRadius * 1.0, center.dy);
    canvas.drawCircle(buttonCenter, 14, buttonGlowPaint);
    canvas.drawCircle(buttonCenter, 8, buttonPaint);
    canvas.drawCircle(buttonCenter, 8, Paint()
      ..color = Colors.white
      ..strokeWidth = 1.5
      ..style = PaintingStyle.stroke);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
