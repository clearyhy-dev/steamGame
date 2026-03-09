import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/theme/app_theme.dart';
import '../../providers/app_providers.dart';

/// 分析流程页：5 步动画，让用户感到「AI 在思考」
/// Detecting Face → Optimizing Composition → Enhancing Lighting → Matching Background → Calculating Attraction Score
class AnalysisScreen extends ConsumerStatefulWidget {
  const AnalysisScreen({super.key});

  @override
  ConsumerState<AnalysisScreen> createState() => _AnalysisScreenState();
}

class _AnalysisScreenState extends ConsumerState<AnalysisScreen> {
  static const _steps = [
    'Analyzing facial harmony…',
    'Optimizing lighting…',
    'Enhancing feminine presence…',
    'Matching elegant background…',
    'Generating attraction report…',
  ];
  int _stepIndex = 0;
  Timer? _timer;
  bool _analysisTriggered = false;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) => _startAnalysis());
    _timer = Timer.periodic(const Duration(milliseconds: 800), (_) {
      if (mounted) {
        setState(() {
          if (_stepIndex < _steps.length - 1) _stepIndex++;
        });
      }
    });
  }

  void _startAnalysis() {
    if (_analysisTriggered) return;
    _analysisTriggered = true;
    ref.read(analyzeProvider)();
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final loading = ref.watch(analysisLoadingProvider);
    final error = ref.watch(analysisErrorProvider);

    // 分析完成 → 跳转结果页
    if (!loading && error == null && ref.read(analysisResultProvider) != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          Navigator.of(context).pushReplacementNamed('/result');
        }
      });
    }

    return Scaffold(
      backgroundColor: appSurfaceDark,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 32),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              if (error != null) ...[
                Icon(Icons.error_outline, size: 56, color: Colors.red.shade300),
                const SizedBox(height: 24),
                Text(
                  error,
                  textAlign: TextAlign.center,
                  style: GoogleFonts.inter(color: appLightGray, fontSize: 15),
                ),
                const SizedBox(height: 24),
                TextButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Back'),
                ),
              ] else ...[
                // 当前步骤（每步 0.8s 切换）
                Text(
                  _steps[_stepIndex],
                  style: GoogleFonts.inter(
                    fontSize: 18,
                    color: appCreamWhite,
                    fontWeight: FontWeight.w500,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 48),
                SizedBox(
                  width: 36,
                  height: 36,
                  child: CircularProgressIndicator(
                    strokeWidth: 3,
                    valueColor: AlwaysStoppedAnimation<Color>(appCreamGold),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
