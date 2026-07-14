import 'dart:async';

import 'package:flutter/material.dart';

import '../../app.dart';
import '../../core/theme/colors.dart';

/// 启动桥接：立刻展示暗色启动页与轮播英文卖点，并行跑关键初始化后淡入主应用。
class SplashBootstrap extends StatelessWidget {
  const SplashBootstrap({
    super.key,
    required this.bootstrap,
  });

  final Future<void> Function() bootstrap;

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: ThemeData.dark(useMaterial3: true).copyWith(
        scaffoldBackgroundColor: const Color(0xFF0D1321),
      ),
      home: _SplashHome(bootstrap: bootstrap),
    );
  }
}

class _SplashHome extends StatefulWidget {
  const _SplashHome({required this.bootstrap});

  final Future<void> Function() bootstrap;

  @override
  State<_SplashHome> createState() => _SplashHomeState();
}

class _SplashHomeState extends State<_SplashHome>
    with SingleTickerProviderStateMixin {
  static const _tips = <String>[
    'Find the lowest Steam prices — fast.',
    'AI compares Steam, ITAD & GG.deals.',
    'Three top deal sites. One best price.',
    'Stop overpaying. Grab the real lowest deal.',
    'Welcome to Steam AI Deal Alert.',
  ];

  static const _minDisplay = Duration(milliseconds: 700);
  static const _maxWait = Duration(seconds: 4);

  late final AnimationController _fadeCtrl;
  late final Animation<double> _fade;
  int _tipIndex = 0;
  Timer? _tipTimer;
  bool _ready = false;
  bool _entered = false;

  @override
  void initState() {
    super.initState();
    _fadeCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 380),
    );
    _fade = CurvedAnimation(parent: _fadeCtrl, curve: Curves.easeInOut);
    _fadeCtrl.value = 1;
    _tipTimer = Timer.periodic(const Duration(milliseconds: 1700), (_) {
      _nextTip();
    });
    unawaited(_runBootstrap());
  }

  Future<void> _runBootstrap() async {
    final started = DateTime.now();
    try {
      await widget.bootstrap().timeout(_maxWait, onTimeout: () {});
    } catch (_) {}
    final elapsed = DateTime.now().difference(started);
    final remain = _minDisplay - elapsed;
    if (remain > Duration.zero) {
      await Future<void>.delayed(remain);
    }
    if (!mounted) return;
    setState(() => _ready = true);
    _enterApp();
  }

  void _enterApp() {
    if (_entered || !_ready || !mounted) return;
    _entered = true;
    _tipTimer?.cancel();
    // 替换整棵 widget 树，避免嵌套第二层 MaterialApp。
    runApp(const SteamDealApp());
  }

  Future<void> _nextTip() async {
    if (!mounted) return;
    await _fadeCtrl.reverse();
    if (!mounted) return;
    setState(() => _tipIndex = (_tipIndex + 1) % _tips.length);
    await _fadeCtrl.forward();
  }

  @override
  void dispose() {
    _tipTimer?.cancel();
    _fadeCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tip = _tips[_tipIndex];
    return Scaffold(
      backgroundColor: const Color(0xFF0D1321),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            children: [
              const Spacer(flex: 3),
              ClipRRect(
                borderRadius: BorderRadius.circular(18),
                child: Image.asset(
                  'assets/app_icon_512.png',
                  width: 88,
                  height: 88,
                  fit: BoxFit.cover,
                  errorBuilder: (_, __, ___) => Container(
                    width: 88,
                    height: 88,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(
                      color: AppColors.cardDark,
                      borderRadius: BorderRadius.circular(18),
                    ),
                    child: const Text(
                      '-%',
                      style: TextStyle(
                        color: AppColors.itadOrange,
                        fontSize: 28,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 22),
              const Text(
                'Steam AI Deal Alert',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AppColors.textPrimary,
                  fontSize: 22,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.2,
                ),
              ),
              const SizedBox(height: 8),
              Text(
                'Steam · ITAD · GG.deals',
                textAlign: TextAlign.center,
                style: TextStyle(
                  color: AppColors.itadOrange.withValues(alpha: 0.9),
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 0.6,
                ),
              ),
              const SizedBox(height: 28),
              SizedBox(
                height: 56,
                child: FadeTransition(
                  opacity: _fade,
                  child: Text(
                    tip,
                    key: ValueKey<int>(_tipIndex),
                    textAlign: TextAlign.center,
                    style: const TextStyle(
                      color: AppColors.textSecondary,
                      fontSize: 15,
                      height: 1.35,
                      fontWeight: FontWeight.w500,
                    ),
                  ),
                ),
              ),
              const Spacer(flex: 4),
              SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  color: AppColors.itadOrange.withValues(alpha: 0.85),
                  backgroundColor: Colors.white10,
                ),
              ),
              const SizedBox(height: 28),
            ],
          ),
        ),
      ),
    );
  }
}
