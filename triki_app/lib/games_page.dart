import 'dart:async';
import 'dart:math';
import 'package:flutter/material.dart';

// ═══════════════════════════════════════════════════════════
//  SHARED SENSOR DATA (updated from BLE frame processing)
// ═══════════════════════════════════════════════════════════

class TrikiSensorData {
  final double gx, gy, gz; // gyro deg/s
  final double ax, ay, az; // accel g

  const TrikiSensorData({
    this.gx = 0, this.gy = 0, this.gz = 0,
    this.ax = 0, this.ay = 0, this.az = 0,
  });
}

// Global notifier – updated from _DashboardPageState._processFrame
final sensorStream = ValueNotifier<TrikiSensorData>(const TrikiSensorData());
// Global flag – set to true when a game is running (pauses mouse mode)
final gameActive = ValueNotifier<bool>(false);

// ═══════════════════════════════════════════════════════════
//  GAMES HUB PAGE
// ═══════════════════════════════════════════════════════════

class GamesPage extends StatelessWidget {
  const GamesPage({super.key});

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            expandedHeight: 100,
            pinned: true,
            backgroundColor: Colors.transparent,
            flexibleSpace: FlexibleSpaceBar(
              titlePadding: const EdgeInsets.only(left: 16, bottom: 14),
              title: const Text('Minigry 🎮',
                  style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800)),
              background: Container(
                decoration: BoxDecoration(
                  gradient: LinearGradient(
                    colors: [
                      cs.tertiary.withOpacity(0.3),
                      cs.secondary.withOpacity(0.1),
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                ),
              ),
            ),
          ),
          SliverPadding(
            padding: const EdgeInsets.all(14),
            sliver: SliverList(
              delegate: SliverChildListDelegate([
                _GameCard(
                  emoji: '🎯',
                  title: 'Catch the Dot',
                  description: 'Złap świecące punkty żyroskopem!\n30 sekund – ile zdobędziesz?',
                  color: cs.primary,
                  difficulty: 'Łatwa',
                  onPlay: () => Navigator.push(context,
                      MaterialPageRoute(builder: (_) => const CatchDotGame())),
                ),
                const SizedBox(height: 12),
                _GameCard(
                  emoji: '🏓',
                  title: 'Gyro Pong',
                  description: 'Klasyczny Pong – przechylaj żeby ruszać paletką.\nPokonaj AI!',
                  color: cs.secondary,
                  difficulty: 'Średnia',
                  onPlay: () => Navigator.push(context,
                      MaterialPageRoute(builder: (_) => const PongGame())),
                ),
                const SizedBox(height: 12),
                _GameCard(
                  emoji: '🐸',
                  title: 'Żabka łapie muchy',
                  description: 'Muchy lecą ze wszystkich stron.\nPrzechylaj i klikaj żeby łapać!',
                  color: const Color(0xFF22C55E),
                  difficulty: 'Trudna',
                  onPlay: () => Navigator.push(context,
                      MaterialPageRoute(builder: (_) => const FrogFlyGame())),
                ),
                const SizedBox(height: 24),
                Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    color: Colors.amber.withOpacity(0.08),
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: Colors.amber.withOpacity(0.3)),
                  ),
                  child: const Row(
                    children: [
                      Text('💡', style: TextStyle(fontSize: 20)),
                      SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          'Gry sterowane są żyroskopem kapsla BLE.\nPodczas gry mysz jest pauzowana.',
                          style: TextStyle(fontSize: 12, color: Colors.amber),
                        ),
                      ),
                    ],
                  ),
                ),
              ]),
            ),
          ),
        ],
      ),
    );
  }
}

class _GameCard extends StatelessWidget {
  final String emoji, title, description, difficulty;
  final Color color;
  final VoidCallback onPlay;

  const _GameCard({
    required this.emoji, required this.title, required this.description,
    required this.difficulty, required this.color, required this.onPlay,
  });

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return Container(
      decoration: BoxDecoration(
        color: isDark ? const Color(0xFF0F1420) : Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: color.withOpacity(0.3)),
        boxShadow: [
          BoxShadow(color: color.withOpacity(0.15), blurRadius: 20, offset: const Offset(0, 6)),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              width: 64, height: 64,
              decoration: BoxDecoration(
                color: color.withOpacity(0.12),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Center(child: Text(emoji, style: const TextStyle(fontSize: 32))),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(children: [
                    Text(title, style: TextStyle(fontSize: 16, fontWeight: FontWeight.w800, color: color)),
                    const Spacer(),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: color.withOpacity(0.1),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(difficulty, style: TextStyle(fontSize: 10, color: color)),
                    ),
                  ]),
                  const SizedBox(height: 6),
                  Text(description, style: const TextStyle(fontSize: 12, color: Colors.grey)),
                  const SizedBox(height: 10),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: color,
                        foregroundColor: Colors.black,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                        padding: const EdgeInsets.symmetric(vertical: 10),
                      ),
                      onPressed: onPlay,
                      child: const Text('GRAJ', style: TextStyle(fontWeight: FontWeight.bold)),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ═══════════════════════════════════════════════════════════
//  GRA 1: CATCH THE DOT
// ═══════════════════════════════════════════════════════════

class CatchDotGame extends StatefulWidget {
  const CatchDotGame({super.key});
  @override
  State<CatchDotGame> createState() => _CatchDotGameState();
}

class _CatchDotGameState extends State<CatchDotGame> with TickerProviderStateMixin {
  static const _gameDuration = 30;
  final _rng = Random();

  // Game state
  bool _running = false, _over = false;
  int _score = 0, _highScore = 0, _timeLeft = _gameDuration;
  double _curX = 0.5, _curY = 0.5; // normalized 0-1
  double _dotX = 0.5, _dotY = 0.5;
  double _dotSize = 0.12;
  Timer? _gameTimer, _loopTimer;

  late AnimationController _dotPulse;
  late AnimationController _catchAnim;

  @override
  void initState() {
    super.initState();
    _dotPulse = AnimationController(vsync: this, duration: const Duration(milliseconds: 800))
      ..repeat(reverse: true);
    _catchAnim = AnimationController(vsync: this, duration: const Duration(milliseconds: 300));
    _spawnDot();
    gameActive.value = true;
  }

  @override
  void dispose() {
    gameActive.value = false;
    _gameTimer?.cancel();
    _loopTimer?.cancel();
    _dotPulse.dispose();
    _catchAnim.dispose();
    super.dispose();
  }

  void _startGame() {
    setState(() { _score = 0; _timeLeft = _gameDuration; _running = true; _over = false; _dotSize = 0.12; });
    _curX = 0.5; _curY = 0.5;
    _spawnDot();

    _gameTimer = Timer.periodic(const Duration(seconds: 1), (_) {
      setState(() => _timeLeft--);
      if (_timeLeft <= 0) _endGame();
    });

    _loopTimer = Timer.periodic(const Duration(milliseconds: 33), (_) {
      final s = sensorStream.value;
      setState(() {
        // Air mouse mode: gz → X, gx → Y
        _curX = (_curX - s.gz * 0.0012).clamp(0.0, 1.0);
        _curY = (_curY + s.gx * 0.0012).clamp(0.0, 1.0);
      });
      _checkCatch();
    });
  }

  void _endGame() {
    _gameTimer?.cancel(); _loopTimer?.cancel();
    if (_score > _highScore) _highScore = _score;
    setState(() { _running = false; _over = true; });
  }

  void _spawnDot() {
    setState(() {
      _dotX = 0.1 + _rng.nextDouble() * 0.8;
      _dotY = 0.1 + _rng.nextDouble() * 0.8;
    });
  }

  void _checkCatch() {
    final dx = _curX - _dotX, dy = _curY - _dotY;
    if (sqrt(dx * dx + dy * dy) < _dotSize * 0.6) {
      setState(() {
        _score++;
        _dotSize = max(0.06, _dotSize - 0.003); // shrinks over time
      });
      _catchAnim.forward(from: 0);
      _spawnDot();
    }
  }

  @override
  Widget build(BuildContext context) {
    final size = MediaQuery.of(context).size;
    final cs = Theme.of(context).colorScheme;

    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        title: Row(children: [
          const Text('🎯 Catch the Dot', style: TextStyle(color: Colors.white)),
          const Spacer(),
          if (_running) ...[
            Text('⏱ $_timeLeft s',
                style: TextStyle(color: _timeLeft <= 5 ? Colors.red : Colors.white, fontWeight: FontWeight.bold)),
            const SizedBox(width: 16),
            Text('⭐ $_score', style: const TextStyle(color: Colors.yellow, fontWeight: FontWeight.bold)),
          ],
        ]),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: _over
          ? _buildGameOver(cs)
          : !_running
              ? _buildStart(cs)
              : _buildGameArea(size, cs),
    );
  }

  Widget _buildStart(ColorScheme cs) => Center(
    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      const Text('🎯', style: TextStyle(fontSize: 80)),
      const SizedBox(height: 20),
      const Text('Catch the Dot',
          style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: Colors.white)),
      const SizedBox(height: 10),
      Text('30 sekund | Ruszaj żyroskopem\nNajdź i złap świecący punkt!',
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.grey.shade400, fontSize: 14)),
      if (_highScore > 0) ...[
        const SizedBox(height: 16),
        Text('🏆 Rekord: $_highScore',
            style: TextStyle(color: Colors.yellow, fontSize: 18, fontWeight: FontWeight.bold)),
      ],
      const SizedBox(height: 30),
      ElevatedButton(
        style: ElevatedButton.styleFrom(
          backgroundColor: cs.primary,
          foregroundColor: Colors.black,
          padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 16),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        ),
        onPressed: _startGame,
        child: const Text('START', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
      ),
    ]),
  );

  Widget _buildGameOver(ColorScheme cs) => Center(
    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      const Text('⏰', style: TextStyle(fontSize: 64)),
      const SizedBox(height: 16),
      const Text('Koniec!', style: TextStyle(fontSize: 32, fontWeight: FontWeight.w800, color: Colors.white)),
      const SizedBox(height: 12),
      Text('Wynik: $_score punktów',
          style: TextStyle(fontSize: 22, color: cs.primary, fontWeight: FontWeight.bold)),
      if (_score == _highScore && _score > 0)
        const Padding(
          padding: EdgeInsets.only(top: 8),
          child: Text('🏆 Nowy rekord!',
              style: TextStyle(color: Colors.yellow, fontSize: 18, fontWeight: FontWeight.bold)),
        ),
      const SizedBox(height: 30),
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        OutlinedButton(
          style: OutlinedButton.styleFrom(foregroundColor: Colors.white,
              side: const BorderSide(color: Colors.white30)),
          onPressed: () => Navigator.pop(context),
          child: const Text('Menu'),
        ),
        const SizedBox(width: 16),
        ElevatedButton(
          style: ElevatedButton.styleFrom(backgroundColor: cs.primary, foregroundColor: Colors.black),
          onPressed: _startGame,
          child: const Text('NOWA GRA'),
        ),
      ]),
    ]),
  );

  Widget _buildGameArea(Size size, ColorScheme cs) {
    final areaH = size.height - kToolbarHeight - MediaQuery.of(context).padding.top;
    return Stack(
      children: [
        // Background grid
        CustomPaint(size: Size(size.width, areaH), painter: _GridPainter()),

        // Dot
        AnimatedBuilder(
          animation: _dotPulse,
          builder: (_, __) {
            final pulse = 0.9 + _dotPulse.value * 0.2;
            final ds = size.width * _dotSize * pulse;
            return Positioned(
              left: _dotX * size.width - ds / 2,
              top: _dotY * areaH - ds / 2,
              child: Container(
                width: ds, height: ds,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: cs.primary,
                  boxShadow: [
                    BoxShadow(color: cs.primary.withOpacity(0.6), blurRadius: 20, spreadRadius: 4),
                  ],
                ),
                child: const Center(child: Text('✦', style: TextStyle(color: Colors.white, fontSize: 14))),
              ),
            );
          },
        ),

        // Cursor
        Positioned(
          left: _curX * size.width - 18,
          top: _curY * areaH - 18,
          child: ScaleTransition(
            scale: Tween(begin: 1.0, end: 1.5)
                .animate(CurvedAnimation(parent: _catchAnim, curve: Curves.elasticOut)),
            child: Container(
              width: 36, height: 36,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white, width: 2),
                color: Colors.white.withOpacity(0.1),
              ),
              child: const Center(child: Text('🎯', style: TextStyle(fontSize: 14))),
            ),
          ),
        ),

        // Timer bar
        Positioned(
          bottom: 0, left: 0, right: 0,
          child: LinearProgressIndicator(
            value: _timeLeft / _gameDuration,
            backgroundColor: Colors.white12,
            valueColor: AlwaysStoppedAnimation(
                _timeLeft > 10 ? cs.primary : Colors.red),
            minHeight: 4,
          ),
        ),
      ],
    );
  }
}

class _GridPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()..color = Colors.white.withOpacity(0.04)..strokeWidth = 1;
    const step = 40.0;
    for (double x = 0; x < size.width; x += step) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (double y = 0; y < size.height; y += step) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }
  @override
  bool shouldRepaint(_) => false;
}

// ═══════════════════════════════════════════════════════════
//  GRA 2: GYRO PONG
// ═══════════════════════════════════════════════════════════

class PongGame extends StatefulWidget {
  const PongGame({super.key});
  @override
  State<PongGame> createState() => _PongGameState();
}

class _PongGameState extends State<PongGame> {
  static const _paddleW = 0.25, _paddleH = 0.025;
  static const _ballR = 0.02;

  bool _running = false, _over = false;
  int _playerScore = 0, _aiScore = 0;
  double _playerX = 0.5; // paddle center x (normalized)
  double _aiX    = 0.5;
  double _ballX  = 0.5, _ballY = 0.5;
  double _ballVX = 0.007, _ballVY = 0.007;
  String _winner = '';
  Timer? _loopTimer;

  @override
  void initState() { super.initState(); gameActive.value = true; }
  @override
  void dispose() { gameActive.value = false; _loopTimer?.cancel(); super.dispose(); }

  void _startGame() {
    setState(() { _playerScore = 0; _aiScore = 0; _running = true; _over = false; });
    _resetBall();
    _loopTimer = Timer.periodic(const Duration(milliseconds: 16), (_) => _tick());
  }

  void _resetBall() {
    _ballX = 0.5; _ballY = 0.5;
    final angle = (Random().nextDouble() * 0.6 + 0.2);
    _ballVX = 0.007 * cos(angle) * (Random().nextBool() ? 1 : -1);
    _ballVY = 0.008 * (Random().nextBool() ? 1 : -1);
  }

  void _tick() {
    final s = sensorStream.value;
    setState(() {
      // Move player paddle
      _playerX = (_playerX - s.gz * 0.0008).clamp(_paddleW / 2, 1 - _paddleW / 2);

      // AI: tracks ball smoothly
      final aiSpeed = 0.012;
      if (_ballX < _aiX - 0.02) _aiX -= aiSpeed;
      if (_ballX > _aiX + 0.02) _aiX += aiSpeed;
      _aiX = _aiX.clamp(_paddleW / 2, 1 - _paddleW / 2);

      // Move ball
      _ballX += _ballVX;
      _ballY += _ballVY;

      // Wall bounce
      if (_ballX < _ballR || _ballX > 1 - _ballR) _ballVX *= -1;

      // Player paddle (bottom)
      if (_ballY > 1 - _paddleH - _ballR * 2 &&
          _ballY < 1 - _paddleH &&
          (_ballX - _playerX).abs() < _paddleW / 2 + _ballR) {
        _ballVY = -_ballVY.abs();
        // Add spin based on hit position
        _ballVX += (_ballX - _playerX) * 0.015;
        _ballVX = _ballVX.clamp(-0.018, 0.018);
        // Speed up slightly
        _ballVY = (_ballVY.abs() + 0.0003) * (_ballVY < 0 ? -1 : 1);
      }

      // AI paddle (top)
      if (_ballY < _paddleH + _ballR * 2 &&
          _ballY > _paddleH &&
          (_ballX - _aiX).abs() < _paddleW / 2 + _ballR) {
        _ballVY = _ballVY.abs();
        _ballVX += (_ballX - _aiX) * 0.01;
        _ballVX = _ballVX.clamp(-0.018, 0.018);
      }

      // Score
      if (_ballY > 1.05) { _aiScore++;  _checkWin(); _resetBall(); }
      if (_ballY < -0.05) { _playerScore++; _checkWin(); _resetBall(); }
    });
  }

  void _checkWin() {
    if (_playerScore >= 5 || _aiScore >= 5) {
      _loopTimer?.cancel();
      _winner = _playerScore >= 5 ? '🎉 Wygrałeś!' : '🤖 AI wygrywa!';
      setState(() { _running = false; _over = true; });
    }
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        title: Text('🏓 Gyro Pong', style: const TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
      ),
      body: _over
          ? _buildEndScreen(cs)
          : !_running
              ? _buildStart(cs)
              : _buildField(cs),
    );
  }

  Widget _buildStart(ColorScheme cs) => Center(
    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      const Text('🏓', style: TextStyle(fontSize: 80)),
      const SizedBox(height: 20),
      const Text('Gyro Pong',
          style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: Colors.white)),
      const SizedBox(height: 10),
      Text('Przechylaj urządzenie – steruj paletką\nPierwszy do 5 punktów wygrywa!',
          textAlign: TextAlign.center,
          style: TextStyle(color: Colors.grey.shade400, fontSize: 14)),
      const SizedBox(height: 30),
      ElevatedButton(
        style: ElevatedButton.styleFrom(
          backgroundColor: cs.secondary,
          foregroundColor: Colors.white,
          padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 16),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        ),
        onPressed: _startGame,
        child: const Text('START', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
      ),
    ]),
  );

  Widget _buildEndScreen(ColorScheme cs) => Center(
    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      Text(_winner, style: const TextStyle(fontSize: 32, color: Colors.white, fontWeight: FontWeight.bold)),
      const SizedBox(height: 16),
      Text('$_playerScore : $_aiScore',
          style: TextStyle(fontSize: 40, color: cs.secondary, fontWeight: FontWeight.w800)),
      const SizedBox(height: 30),
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        OutlinedButton(
          style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: Colors.white30)),
          onPressed: () => Navigator.pop(context),
          child: const Text('Menu'),
        ),
        const SizedBox(width: 16),
        ElevatedButton(
          style: ElevatedButton.styleFrom(backgroundColor: cs.secondary, foregroundColor: Colors.white),
          onPressed: _startGame,
          child: const Text('NOWA GRA'),
        ),
      ]),
    ]),
  );

  Widget _buildField(ColorScheme cs) {
    final size = MediaQuery.of(context).size;
    final h = size.height - kToolbarHeight - MediaQuery.of(context).padding.top;
    final w = size.width;
    final pw = w * _paddleW, ph = h * _paddleH;
    final br = w * _ballR;

    return Stack(children: [
      // Background
      Container(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            colors: [Colors.blue.withOpacity(0.05), Colors.purple.withOpacity(0.05)],
            begin: Alignment.topCenter, end: Alignment.bottomCenter,
          ),
        ),
      ),
      // Center line
      Positioned(left: 0, right: 0, top: h / 2 - 1,
        child: Row(children: List.generate(20, (i) => Expanded(
          child: Container(height: 2, color: i.isEven ? Colors.white24 : Colors.transparent),
        ))),
      ),
      // Score
      Positioned(top: 20, left: 0, right: 0,
        child: Row(mainAxisAlignment: MainAxisAlignment.center, children: [
          Text('$_playerScore', style: TextStyle(fontSize: 36, color: cs.primary, fontWeight: FontWeight.w800)),
          const Text('  :  ', style: TextStyle(fontSize: 24, color: Colors.white30)),
          Text('$_aiScore',   style: const TextStyle(fontSize: 36, color: Colors.redAccent, fontWeight: FontWeight.w800)),
        ]),
      ),
      // AI label
      const Positioned(top: 60, left: 0, right: 0,
        child: Center(child: Text('🤖 AI', style: TextStyle(color: Colors.white30, fontSize: 12)))),
      const Positioned(bottom: 20, left: 0, right: 0,
        child: Center(child: Text('👤 TY', style: TextStyle(color: Colors.white30, fontSize: 12)))),

      // AI paddle
      Positioned(
        left: _aiX * w - pw / 2,
        top: h * _paddleH,
        child: Container(
          width: pw, height: ph,
          decoration: BoxDecoration(
            color: Colors.redAccent,
            borderRadius: BorderRadius.circular(ph / 2),
            boxShadow: [BoxShadow(color: Colors.red.withOpacity(0.5), blurRadius: 12)],
          ),
        ),
      ),
      // Player paddle
      Positioned(
        left: _playerX * w - pw / 2,
        top: h * (1 - _paddleH * 2),
        child: Container(
          width: pw, height: ph,
          decoration: BoxDecoration(
            color: cs.primary,
            borderRadius: BorderRadius.circular(ph / 2),
            boxShadow: [BoxShadow(color: cs.primary.withOpacity(0.5), blurRadius: 12)],
          ),
        ),
      ),
      // Ball
      Positioned(
        left: _ballX * w - br,
        top: _ballY * h - br,
        child: Container(
          width: br * 2, height: br * 2,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: Colors.white,
            boxShadow: [BoxShadow(color: Colors.white.withOpacity(0.6), blurRadius: 12)],
          ),
        ),
      ),
    ]);
  }
}

// ═══════════════════════════════════════════════════════════
//  GRA 3: ŻABKA ŁAPIE MUCHY
// ═══════════════════════════════════════════════════════════

class _Fly {
  double x, y, vx, vy;
  bool caught = false;
  _Fly({required this.x, required this.y, required this.vx, required this.vy});
}

class FrogFlyGame extends StatefulWidget {
  const FrogFlyGame({super.key});
  @override
  State<FrogFlyGame> createState() => _FrogFlyGameState();
}

class _FrogFlyGameState extends State<FrogFlyGame> with TickerProviderStateMixin {
  final _rng = Random();
  bool _running = false, _over = false;
  int _score = 0, _lives = 3, _highScore = 0, _wave = 1;
  double _curX = 0.5, _curY = 0.5;
  final List<_Fly> _flies = [];
  Timer? _loopTimer, _spawnTimer;

  late AnimationController _frogBlink;

  @override
  void initState() {
    super.initState();
    _frogBlink = AnimationController(vsync: this, duration: const Duration(milliseconds: 400))
      ..repeat(reverse: true);
    gameActive.value = true;
  }
  @override
  void dispose() { gameActive.value = false; _loopTimer?.cancel(); _spawnTimer?.cancel(); _frogBlink.dispose(); super.dispose(); }

  void _startGame() {
    setState(() { _score = 0; _lives = 3; _wave = 1; _running = true; _over = false; _flies.clear(); });
    _curX = 0.5; _curY = 0.5;
    _startSpawning();
    _loopTimer = Timer.periodic(const Duration(milliseconds: 33), (_) => _tick());
  }

  void _startSpawning() {
    _spawnTimer?.cancel();
    final interval = max(800, 2000 - _wave * 150);
    _spawnTimer = Timer.periodic(Duration(milliseconds: interval), (_) => _spawnFly());
    // Spawn first batch
    for (int i = 0; i < _wave + 1; i++) _spawnFly();
  }

  void _spawnFly() {
    if (!_running) return;
    final side = _rng.nextInt(4);
    double x, y;
    switch (side) {
      case 0: x = _rng.nextDouble(); y = -0.05; break;
      case 1: x = _rng.nextDouble(); y = 1.05; break;
      case 2: x = -0.05; y = _rng.nextDouble(); break;
      default: x = 1.05; y = _rng.nextDouble(); break;
    }
    const speed = 0.003;
    final toCenterX = 0.5 - x, toCenterY = 0.5 - y;
    final len = sqrt(toCenterX * toCenterX + toCenterY * toCenterY);
    final vx = (toCenterX / len) * speed * (0.8 + _rng.nextDouble() * 0.5 + _wave * 0.1);
    final vy = (toCenterY / len) * speed * (0.8 + _rng.nextDouble() * 0.5 + _wave * 0.1);
    setState(() => _flies.add(_Fly(x: x, y: y, vx: vx, vy: vy)));
  }

  void _tick() {
    final s = sensorStream.value;
    setState(() {
      // Move cursor (tongue aim)
      _curX = (_curX - s.gz * 0.0010).clamp(0.0, 1.0);
      _curY = (_curY + s.gx * 0.0010).clamp(0.0, 1.0);

      // Move flies
      for (final fly in _flies) {
        if (fly.caught) continue;
        fly.x += fly.vx;
        fly.y += fly.vy;

        // Fly reached center area → lose a life
        final dx = fly.x - 0.5, dy = fly.y - 0.5;
        if (sqrt(dx * dx + dy * dy) < 0.07) {
          fly.caught = true;
          _lives--;
          if (_lives <= 0) _endGame();
        }
      }
      _flies.removeWhere((f) => f.caught);
    });
  }

  // Physical button click = tongue = catch fly under cursor
  void _catchFly() {
    if (!_running) return;
    bool caught = false;
    for (final fly in _flies) {
      final dx = _curX - fly.x, dy = _curY - fly.y;
      if (sqrt(dx * dx + dy * dy) < 0.1) {
        fly.caught = true;
        caught = true;
        _score++;
        if (_score % 10 == 0) {
          _wave++;
          _startSpawning();
        }
      }
    }
    if (caught) setState(() => _flies.removeWhere((f) => f.caught));
  }

  void _endGame() {
    _loopTimer?.cancel(); _spawnTimer?.cancel();
    if (_score > _highScore) _highScore = _score;
    setState(() { _running = false; _over = true; _flies.clear(); });
  }

  @override
  Widget build(BuildContext context) {
    final cs = Theme.of(context).colorScheme;
    return Scaffold(
      backgroundColor: const Color(0xFF071A0B),
      appBar: AppBar(
        backgroundColor: Colors.transparent,
        title: _running
            ? Row(children: [
                const Text('🐸 Żabka', style: TextStyle(color: Colors.white)),
                const Spacer(),
                ...List.generate(_lives, (_) => const Text('❤️', style: TextStyle(fontSize: 18))),
                const SizedBox(width: 12),
                Text('⭐ $_score', style: const TextStyle(color: Colors.yellow, fontWeight: FontWeight.bold)),
                const SizedBox(width: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                  decoration: BoxDecoration(color: Colors.white12, borderRadius: BorderRadius.circular(10)),
                  child: Text('W$_wave', style: const TextStyle(color: Colors.white, fontSize: 12)),
                ),
              ])
            : const Text('🐸 Żabka łapie muchy', style: TextStyle(color: Colors.white)),
        iconTheme: const IconThemeData(color: Colors.white),
        actions: _running
            ? [IconButton(icon: const Icon(Icons.touch_app, color: Colors.green),
                tooltip: 'Klik = łap muchę',
                onPressed: _catchFly)]
            : null,
      ),
      body: _over
          ? _buildEnd(cs)
          : !_running
              ? _buildStart(cs)
              : _buildField(cs),
      floatingActionButton: _running
          ? FloatingActionButton(
              backgroundColor: const Color(0xFF22C55E),
              onPressed: _catchFly,
              child: const Text('👅', style: TextStyle(fontSize: 24)),
            )
          : null,
    );
  }

  Widget _buildStart(ColorScheme cs) => Center(
    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      const Text('🐸', style: TextStyle(fontSize: 80)),
      const SizedBox(height: 20),
      const Text('Żabka łapie muchy',
          style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800, color: Colors.white)),
      const SizedBox(height: 10),
      Text(
        'Przechylaj żeby celować\nKlikaj przycisk (lub 👅) żeby łapać muchy\n3 muchy przez środek = koniec!',
        textAlign: TextAlign.center,
        style: TextStyle(color: Colors.grey.shade400, fontSize: 14),
      ),
      if (_highScore > 0) ...[
        const SizedBox(height: 16),
        Text('🏆 Rekord: $_highScore', style: const TextStyle(color: Colors.yellow, fontSize: 18, fontWeight: FontWeight.bold)),
      ],
      const SizedBox(height: 30),
      ElevatedButton(
        style: ElevatedButton.styleFrom(
          backgroundColor: const Color(0xFF22C55E),
          foregroundColor: Colors.black,
          padding: const EdgeInsets.symmetric(horizontal: 40, vertical: 16),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
        ),
        onPressed: _startGame,
        child: const Text('START', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
      ),
    ]),
  );

  Widget _buildEnd(ColorScheme cs) => Center(
    child: Column(mainAxisAlignment: MainAxisAlignment.center, children: [
      const Text('💀', style: TextStyle(fontSize: 64)),
      const SizedBox(height: 16),
      const Text('Zjadły żabkę!',
          style: TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: Colors.white)),
      const SizedBox(height: 12),
      Text('Złapałeś $_score much!',
          style: TextStyle(fontSize: 22, color: const Color(0xFF22C55E), fontWeight: FontWeight.bold)),
      if (_score == _highScore && _score > 0)
        const Padding(
          padding: EdgeInsets.only(top: 8),
          child: Text('🏆 Nowy rekord!', style: TextStyle(color: Colors.yellow, fontSize: 18, fontWeight: FontWeight.bold)),
        ),
      const SizedBox(height: 30),
      Row(mainAxisAlignment: MainAxisAlignment.center, children: [
        OutlinedButton(
          style: OutlinedButton.styleFrom(foregroundColor: Colors.white, side: const BorderSide(color: Colors.white30)),
          onPressed: () => Navigator.pop(context),
          child: const Text('Menu'),
        ),
        const SizedBox(width: 16),
        ElevatedButton(
          style: ElevatedButton.styleFrom(backgroundColor: const Color(0xFF22C55E), foregroundColor: Colors.black),
          onPressed: _startGame,
          child: const Text('NOWA GRA'),
        ),
      ]),
    ]),
  );

  Widget _buildField(ColorScheme cs) {
    final size = MediaQuery.of(context).size;
    final h = size.height - kToolbarHeight - MediaQuery.of(context).padding.top - 80;
    final w = size.width;

    return GestureDetector(
      onTap: _catchFly,
      child: Stack(children: [
        // Grass bg
        Container(
          decoration: const BoxDecoration(
            gradient: RadialGradient(
              colors: [Color(0xFF0A2E12), Color(0xFF071A0B)],
              center: Alignment.center, radius: 1.2,
            ),
          ),
        ),

        // Flies
        ..._flies.map((fly) => Positioned(
          left: fly.x * w - 16,
          top: fly.y * h - 16,
          child: Text('🦟', style: TextStyle(fontSize: 22 + _wave * 0.5)),
        )),

        // Danger zone
        Center(
          child: Container(
            width: w * 0.14, height: w * 0.14,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: Colors.red.withOpacity(0.12),
              border: Border.all(color: Colors.red.withOpacity(0.3), width: 2),
            ),
            child: const Center(child: Text('🐸', style: TextStyle(fontSize: 36))),
          ),
        ),

        // Cursor / tongue aim
        Positioned(
          left: _curX * w - 20,
          top: _curY * h - 20,
          child: Container(
            width: 40, height: 40,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: Colors.yellow.withOpacity(0.15),
              border: Border.all(color: Colors.yellow.withOpacity(0.6), width: 2),
            ),
            child: const Center(child: Text('🎯', style: TextStyle(fontSize: 16))),
          ),
        ),

        // Wave indicator
        Positioned(bottom: 8, left: 0, right: 0,
          child: Center(
            child: Text('Fala $_wave • ${_flies.length} much',
                style: TextStyle(color: Colors.white.withOpacity(0.4), fontSize: 12)),
          ),
        ),
      ]),
    );
  }
}
