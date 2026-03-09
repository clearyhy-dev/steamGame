import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/localization/app_strings.dart';
import '../../core/theme/app_theme.dart';
import '../../models/photo_model.dart';
import '../../providers/app_providers.dart';

class EnhancePhotoScreen extends ConsumerStatefulWidget {
  const EnhancePhotoScreen({super.key, required this.photoIndex});

  final int photoIndex;

  @override
  ConsumerState<EnhancePhotoScreen> createState() => _EnhancePhotoScreenState();
}

class _EnhancePhotoScreenState extends ConsumerState<EnhancePhotoScreen> {
  static const List<String> _kEnhanceStyleKeys = <String>[
    'portrait',
    'natural_glow',
    'luxury_studio',
    'soft_feminine',
    'flower_crown',
    'princess_tiara',
    'butterfly_aura',
    'sparkle_light',
    'pastel_anime',
  ];

  String _style = 'portrait';

  String _classifySuggestion(RankedPhoto ranked) {
    final t = '${ranked.improvementTip}\n${ranked.reason}'.toLowerCase();
    bool hasBg = t.contains('background') ||
        t.contains('背景') ||
        t.contains('场景') ||
        t.contains('环境') ||
        t.contains('scene');
    bool hasLight = t.contains('light') ||
        t.contains('lighting') ||
        t.contains('曝光') ||
        t.contains('过曝') ||
        t.contains('欠曝') ||
        t.contains('太暗') ||
        t.contains('太亮') ||
        t.contains('光线') ||
        t.contains('阴影');
    bool hasComp = t.contains('composition') ||
        t.contains('framing') ||
        t.contains('angle') ||
        t.contains('crop') ||
        t.contains('构图') ||
        t.contains('角度') ||
        t.contains('裁剪') ||
        t.contains('居中') ||
        t.contains('留白');

    // 优先级：背景 > 构图 > 光线（避免误把背景问题当成调色）
    if (hasBg) return 'background';
    if (hasComp) return 'composition';
    if (hasLight) return 'lighting';
    return 'enhance';
  }

  Future<void> _applySuggestion({
    required RankedPhoto ranked,
    required File file,
  }) async {
    final kind = _classifySuggestion(ranked);
    if (kind == 'background') {
      return;
    }
    if (kind == 'composition') {
      if (!mounted) return;
      Navigator.of(context).pushNamed('/enhance/composition',
          arguments: widget.photoIndex);
      return;
    }
    if (kind == 'lighting') {
      setState(() => _style = 'natural_glow');
      try {
        await ref.read(enhancePhotoProvider)(
          photoIndex: widget.photoIndex,
          style: _style,
        );
      } catch (_) {}
      return;
    }
    // 默认：走美化（不改背景）
    try {
      await ref.read(enhancePhotoProvider)(
        photoIndex: widget.photoIndex,
        style: _style,
      );
    } catch (_) {}
  }

  @override
  Widget build(BuildContext context) {
    final photos = ref.watch(photoProvider);
    final result = ref.watch(analysisResultProvider);

    if (widget.photoIndex < 0 || widget.photoIndex >= photos.length) {
      return Scaffold(
        backgroundColor: appSurfaceDark,
        appBar: AppBar(title: Text('照片')),
        body: Center(
          child: Text('找不到这张照片', style: GoogleFonts.inter(color: appLightGray)),
        ),
      );
    }

    final File file = photos[widget.photoIndex].file;
    final RankedPhoto? ranked = result?.rankedPhotos
        .where((r) => r.index == widget.photoIndex)
        .firstOrNull;

    final enhanceUrlMap = ref.watch(enhanceUrlByIndexProvider);
    final enhancedUrl = enhanceUrlMap[widget.photoIndex];
    final loadingMap = ref.watch(enhanceLoadingByIndexProvider);
    final loading = loadingMap[widget.photoIndex] == true;

    return Scaffold(
      backgroundColor: appSurfaceDark,
      appBar: AppBar(
        title: Text(
          '照片 #${widget.photoIndex + 1}',
          style: GoogleFonts.merriweather(fontWeight: FontWeight.w600),
        ),
        centerTitle: true,
        actions: const [],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: Image.file(
              file,
              height: 240,
              width: double.infinity,
              fit: BoxFit.cover,
            ),
          ),
          const SizedBox(height: 14),
          if (ranked != null)
            _AnalysisCard(
              ranked: ranked,
              onTapSuggestion: ranked.improvementTip.trim().isEmpty
                  ? null
                  : () => _applySuggestion(ranked: ranked, file: file),
            ),
          const SizedBox(height: 14),
          Text(
            '美化风格',
            style: GoogleFonts.inter(
              color: appCreamWhite,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            decoration: BoxDecoration(
              color: appSurfaceCard,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: Colors.white.withOpacity(0.06)),
            ),
            child: DropdownButtonHideUnderline(
              child: DropdownButton<String>(
                value: _style,
                isExpanded: true,
                dropdownColor: appSurfaceCard,
                iconEnabledColor: appCreamWhite,
                items: _kEnhanceStyleKeys
                    .map(
                      (k) => DropdownMenuItem(
                        value: k,
                        child: Text(
                          AppStrings.styleName(k),
                          style: GoogleFonts.inter(color: appCreamWhite),
                        ),
                      ),
                    )
                    .toList(),
                onChanged: loading
                    ? null
                    : (v) => setState(() => _style = v ?? _style),
              ),
            ),
          ),
          const SizedBox(height: 10),
          Text(
            _style == 'portrait'
                ? '人像模式仅提升清晰度/肤色与光线，不会刻意更换或重绘背景。'
                : '不同风格主要影响人物质感与整体观感。',
            style: GoogleFonts.inter(color: appLightGray, fontSize: 12),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: loading
                  ? null
                  : () async {
                      try {
                        await ref.read(enhancePhotoProvider)(
                          photoIndex: widget.photoIndex,
                          style: _style,
                        );
                      } catch (e) {
                        if (!context.mounted) return;
                        final msg = e
                            .toString()
                            .replaceFirst(RegExp(r'^.*?Exception:?\s*'), '');
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text(msg.isEmpty ? '美化失败' : msg),
                            backgroundColor: Colors.red.shade800,
                          ),
                        );
                      }
                    },
              style: ElevatedButton.styleFrom(
                backgroundColor: appCreamGold,
                foregroundColor: Colors.black,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: loading
                  ? const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(
                      '开始美化',
                      style: GoogleFonts.inter(fontWeight: FontWeight.w600),
                    ),
            ),
          ),
          const SizedBox(height: 18),
          Text(
            AppStrings.result,
            style: GoogleFonts.inter(
              color: appCreamWhite,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          if (enhancedUrl == null)
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: appSurfaceCard,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: Colors.white.withOpacity(0.06)),
              ),
              child: Row(
                children: [
                  Icon(Icons.auto_awesome, color: appCreamGold),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      '美化完成后会在这里展示结果图。',
                      style: GoogleFonts.inter(
                          color: appLightGray, fontSize: 12),
                    ),
                  ),
                ],
              ),
            )
          else
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Image.network(
                enhancedUrl,
                height: 320,
                width: double.infinity,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => Container(
                  padding: const EdgeInsets.all(16),
                  color: Colors.white12,
                  child: Text(
                    AppStrings.enhancedVersionError,
                    style: GoogleFonts.inter(color: appLightGray),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _AnalysisCard extends StatelessWidget {
  final RankedPhoto ranked;
  final VoidCallback? onTapSuggestion;

  const _AnalysisCard({required this.ranked, this.onTapSuggestion});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: appSurfaceCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.06)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            '评分：${ranked.score} / 100',
            style: GoogleFonts.inter(
              color: appCreamGold,
              fontSize: 14,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 8),
          if (ranked.firstImpressionPrediction.trim().isNotEmpty)
            _Line(title: '第一印象', value: ranked.firstImpressionPrediction),
          if (ranked.swipeProbability > 0)
            _Line(title: 'Swipe 概率', value: '${ranked.swipeProbability}%'),
          if (ranked.reason.trim().isNotEmpty)
            _Line(title: '原因', value: ranked.reason),
          if (ranked.improvementTip.trim().isNotEmpty)
            _Line(title: '建议', value: ranked.improvementTip),
        ],
      ),
    );
  }
}

class _Line extends StatelessWidget {
  final String title;
  final String value;

  const _Line({required this.title, required this.value});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 64,
            child: Text(
              title,
              style: GoogleFonts.inter(color: appLightGray, fontSize: 12),
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: GoogleFonts.inter(color: appCreamWhite, fontSize: 12),
            ),
          ),
        ],
      ),
    );
  }
}

extension<T> on Iterable<T> {
  T? get firstOrNull => isEmpty ? null : first;
}

