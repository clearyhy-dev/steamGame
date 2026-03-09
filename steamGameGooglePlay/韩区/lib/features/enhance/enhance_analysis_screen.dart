import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/theme/app_theme.dart';
import '../../providers/app_providers.dart';

/// 图片美化模块：评分分析过程页（完成后进入模块结果页）
class EnhanceAnalysisScreen extends ConsumerStatefulWidget {
  const EnhanceAnalysisScreen({super.key});

  @override
  ConsumerState<EnhanceAnalysisScreen> createState() =>
      _EnhanceAnalysisScreenState();
}

class _EnhanceAnalysisScreenState extends ConsumerState<EnhanceAnalysisScreen> {
  static const _steps = [
    '正在评分照片…',
    '分析光线与构图…',
    '预测第一印象…',
    '计算 Swipe 概率…',
    '生成优化建议…',
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
    ref.read(enhanceAnalyzeProvider)();
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

    if (!loading && error == null && ref.read(analysisResultProvider) != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (mounted) {
          final photos = ref.read(photoProvider);
          if (photos.length <= 1) {
            Navigator.of(context).pushReplacementNamed('/enhance/photo',
                arguments: 0);
          } else {
            Navigator.of(context).pushReplacementNamed('/enhance/result');
          }
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
                Icon(Icons.error_outline,
                    size: 56, color: Colors.red.shade300),
                const SizedBox(height: 24),
                Text(
                  error,
                  textAlign: TextAlign.center,
                  style: GoogleFonts.inter(color: appLightGray, fontSize: 15),
                ),
                const SizedBox(height: 24),
                TextButton(
                  onPressed: () => Navigator.of(context)
                      .pushReplacementNamed('/enhance'),
                  child: const Text('返回'),
                ),
              ] else ...[
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
                    valueColor:
                        AlwaysStoppedAnimation<Color>(appCreamGold),
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

