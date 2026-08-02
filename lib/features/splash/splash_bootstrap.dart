import 'dart:async';

import 'package:flutter/material.dart';

import '../../app.dart';
import '../../core/theme/colors.dart';

/// 启动桥接：暗色氛围 + 醒目英文卖点轮播，并行关键初始化后进入主应用。
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
        scaffoldBackgroundColor: const Color(0xFF0A0F18),
      ),
      home: _SplashHome(bootstrap: bootstrap),
    );
  }
}

class _Tip {
  const _Tip({required this.eyebrow, required this.line});
  final String eyebrow;
  final String line;
}

class _SplashHome extends StatefulWidget {
  const _SplashHome({required this.bootstrap});

  final Future<void> Function() bootstrap;

  @override
  State<_SplashHome> createState() => _SplashHomeState();
}

class _SplashHomeState extends State<_SplashHome>
    with TickerProviderStateMixin {
  static const _tips = <_Tip>[
    _Tip(
      eyebrow: 'LOWEST PRICE',
      line: 'Find the cheapest Steam deals — instantly.',
    ),
    _Tip(
      eyebrow: '3 STOREFRONTS · 1 WINNER',
      line: 'AI compares Steam, ITAD & GG.deals for you.',
    ),
    _Tip(
      eyebrow: 'STOP OVERPAYING',
      line: 'Three top deal sites. One best price.',
    ),
    _Tip(
      eyebrow: 'SMARTER BUYS',
      line: 'Grab the real lowest deal before it flips.',
    ),
    _Tip(
      eyebrow: 'YOU\'RE IN',
      line: 'Welcome to Steam AI Deal Alert.',
    ),
  ];

  static const _minDisplay = Duration(milliseconds: 1100);
  /// 网络配置可慢；本地登录恢复已放在 bootstrap 最前且不依赖此超时语义。
  static const _maxWait = Duration(seconds: 10);

  late final AnimationController _tipCtrl;
  late final AnimationController _pulseCtrl;
  late final AnimationController _logoCtrl;
  late final Animation<double> _tipFade;
  late final Animation<Offset> _tipSlide;
  late final Animation<double> _logoScale;

  int _tipIndex = 0;
  Timer? _tipTimer;
  bool _ready = false;
  bool _entered = false;

  @override
  void initState() {
    super.initState();
    _tipCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 420),
    );
    _tipFade = CurvedAnimation(parent: _tipCtrl, curve: Curves.easeOutCubic);
    _tipSlide = Tween<Offset>(
      begin: const Offset(0, 0.12),
      end: Offset.zero,
    ).animate(CurvedAnimation(parent: _tipCtrl, curve: Curves.easeOutCubic));
    _tipCtrl.value = 1;

    _pulseCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1400),
    )..repeat(reverse: true);

    _logoCtrl = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 900),
    )..forward();
    _logoScale = Tween<double>(begin: 0.86, end: 1).animate(
      CurvedAnimation(parent: _logoCtrl, curve: Curves.easeOutBack),
    );

    _tipTimer = Timer.periodic(const Duration(milliseconds: 2100), (_) {
      _nextTip();
    });
    unawaited(_runBootstrap());
  }

  Future<void> _runBootstrap() async {
    final started = DateTime.now();
    try {
      // 超时不取消 bootstrap：本地登录恢复已在 bootstrap 最前完成；
      // 网络慢时仍可进主页，后台继续补 JWT。
      await widget.bootstrap().timeout(_maxWait);
    } on TimeoutException {
      // ignore — 关键路径应已完成
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
    runApp(const SteamDealApp());
  }

  Future<void> _nextTip() async {
    if (!mounted) return;
    await _tipCtrl.reverse();
    if (!mounted) return;
    setState(() => _tipIndex = (_tipIndex + 1) % _tips.length);
    await _tipCtrl.forward();
  }

  @override
  void dispose() {
    _tipTimer?.cancel();
    _tipCtrl.dispose();
    _pulseCtrl.dispose();
    _logoCtrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final tip = _tips[_tipIndex];
    final size = MediaQuery.sizeOf(context);

    return Scaffold(
      body: Stack(
        fit: StackFit.expand,
        children: [
          const DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
                colors: [
                  Color(0xFF0A0F18),
                  Color(0xFF121A28),
                  Color(0xFF0D1520),
                ],
              ),
            ),
          ),
          // Soft brand wash — deal orange, not purple glow
          Positioned(
            top: -size.height * 0.12,
            left: -size.width * 0.2,
            child: IgnorePointer(
              child: AnimatedBuilder(
                animation: _pulseCtrl,
                builder: (_, __) {
                  final t = 0.35 + _pulseCtrl.value * 0.2;
                  return Container(
                    width: size.width * 0.9,
                    height: size.width * 0.9,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      gradient: RadialGradient(
                        colors: [
                          AppColors.itadOrange.withValues(alpha: t * 0.28),
                          AppColors.itadOrange.withValues(alpha: 0),
                        ],
                      ),
                    ),
                  );
                },
              ),
            ),
          ),
          Positioned(
            bottom: -80,
            right: -60,
            child: IgnorePointer(
              child: Container(
                width: 220,
                height: 220,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  gradient: RadialGradient(
                    colors: [
                      AppColors.accent.withValues(alpha: 0.12),
                      Colors.transparent,
                    ],
                  ),
                ),
              ),
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 28),
              child: Column(
                children: [
                  const Spacer(flex: 2),
                  ScaleTransition(
                    scale: _logoScale,
                    child: AnimatedBuilder(
                      animation: _pulseCtrl,
                      builder: (_, child) {
                        final glow = 8.0 + _pulseCtrl.value * 10;
                        return Container(
                          padding: const EdgeInsets.all(3),
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(22),
                            boxShadow: [
                              BoxShadow(
                                color: AppColors.itadOrange
                                    .withValues(alpha: 0.35 + _pulseCtrl.value * 0.2),
                                blurRadius: glow,
                                spreadRadius: 1,
                              ),
                            ],
                            gradient: const LinearGradient(
                              colors: [
                                AppColors.itadOrangeLight,
                                AppColors.itadOrange,
                              ],
                            ),
                          ),
                          child: child,
                        );
                      },
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(19),
                        child: Image.asset(
                          'assets/app_icon_512.png',
                          width: 96,
                          height: 96,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => Container(
                            width: 96,
                            height: 96,
                            alignment: Alignment.center,
                            color: AppColors.cardDark,
                            child: const Text(
                              '-%',
                              style: TextStyle(
                                color: AppColors.itadOrange,
                                fontSize: 32,
                                fontWeight: FontWeight.w900,
                              ),
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 26),
                  const Text(
                    'Steam AI Deal Alert',
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: Colors.white,
                      fontSize: 26,
                      fontWeight: FontWeight.w800,
                      letterSpacing: 0.3,
                      height: 1.15,
                    ),
                  ),
                  const SizedBox(height: 10),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
                    decoration: BoxDecoration(
                      color: AppColors.itadOrange.withValues(alpha: 0.14),
                      borderRadius: BorderRadius.circular(6),
                      border: Border.all(
                        color: AppColors.itadOrange.withValues(alpha: 0.55),
                      ),
                    ),
                    child: const Text(
                      'Steam  ·  ITAD  ·  GG.deals',
                      style: TextStyle(
                        color: AppColors.itadOrangeLight,
                        fontSize: 12,
                        fontWeight: FontWeight.w700,
                        letterSpacing: 1.1,
                      ),
                    ),
                  ),
                  const SizedBox(height: 36),
                  // High-contrast tip panel
                  FadeTransition(
                    opacity: _tipFade,
                    child: SlideTransition(
                      position: _tipSlide,
                      child: _TipPanel(
                        key: ValueKey<int>(_tipIndex),
                        tip: tip,
                        pulse: _pulseCtrl,
                      ),
                    ),
                  ),
                  const SizedBox(height: 18),
                  _TipDots(
                    count: _tips.length,
                    index: _tipIndex,
                  ),
                  const Spacer(flex: 3),
                  AnimatedBuilder(
                    animation: _pulseCtrl,
                    builder: (_, __) {
                      return Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          SizedBox(
                            width: 18,
                            height: 18,
                            child: CircularProgressIndicator(
                              strokeWidth: 2.2,
                              color: AppColors.itadOrange.withValues(
                                alpha: 0.75 + _pulseCtrl.value * 0.25,
                              ),
                              backgroundColor: Colors.white12,
                            ),
                          ),
                          const SizedBox(width: 12),
                          Text(
                            'Loading best deals…',
                            style: TextStyle(
                              color: Colors.white.withValues(alpha: 0.72),
                              fontSize: 13,
                              fontWeight: FontWeight.w600,
                              letterSpacing: 0.2,
                            ),
                          ),
                        ],
                      );
                    },
                  ),
                  const SizedBox(height: 32),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _TipPanel extends StatelessWidget {
  const _TipPanel({
    super.key,
    required this.tip,
    required this.pulse,
  });

  final _Tip tip;
  final Animation<double> pulse;

  @override
  Widget build(BuildContext context) {
    return AnimatedBuilder(
      animation: pulse,
      builder: (_, __) {
        final borderAlpha = 0.55 + pulse.value * 0.35;
        return Container(
          width: double.infinity,
          padding: const EdgeInsets.fromLTRB(18, 16, 18, 18),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            gradient: LinearGradient(
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
              colors: [
                const Color(0xFF1A2436).withValues(alpha: 0.95),
                Color.lerp(
                  const Color(0xFF1A2436),
                  AppColors.itadOrange,
                  0.08 + pulse.value * 0.06,
                )!,
              ],
            ),
            border: Border.all(
              color: AppColors.itadOrange.withValues(alpha: borderAlpha),
              width: 1.4,
            ),
            boxShadow: [
              BoxShadow(
                color: AppColors.itadOrange.withValues(alpha: 0.22 + pulse.value * 0.12),
                blurRadius: 18 + pulse.value * 8,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      shape: BoxShape.circle,
                      color: AppColors.itadOrangeLight,
                      boxShadow: [
                        BoxShadow(
                          color: AppColors.itadOrange.withValues(alpha: 0.8),
                          blurRadius: 8,
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      tip.eyebrow,
                      style: TextStyle(
                        color: AppColors.itadOrangeLight.withValues(alpha: 0.95),
                        fontSize: 12,
                        fontWeight: FontWeight.w800,
                        letterSpacing: 1.4,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),
              Text(
                tip.line,
                style: const TextStyle(
                  color: Colors.white,
                  fontSize: 18,
                  height: 1.35,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.15,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

class _TipDots extends StatelessWidget {
  const _TipDots({required this.count, required this.index});

  final int count;
  final int index;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.center,
      children: List.generate(count, (i) {
        final on = i == index;
        return AnimatedContainer(
          duration: const Duration(milliseconds: 280),
          margin: const EdgeInsets.symmetric(horizontal: 3),
          width: on ? 18 : 7,
          height: 7,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(4),
            color: on
                ? AppColors.itadOrange
                : Colors.white.withValues(alpha: 0.22),
          ),
        );
      }),
    );
  }
}






