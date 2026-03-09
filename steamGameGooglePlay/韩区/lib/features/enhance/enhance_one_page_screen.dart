import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/localization/app_strings.dart';
import '../../core/theme/app_theme.dart';
import '../../models/photo_model.dart';
import '../../providers/app_providers.dart';

/// 图片美化（单页闭环）：
/// 选图 → 自动评分（/analyze）→ 展示评分与建议 → 一键美化（/enhance）→ 展示结果
class EnhanceOnePageScreen extends ConsumerStatefulWidget {
  const EnhanceOnePageScreen({super.key});

  @override
  ConsumerState<EnhanceOnePageScreen> createState() =>
      _EnhanceOnePageScreenState();
}

class _EnhanceOnePageScreenState extends ConsumerState<EnhanceOnePageScreen> {
  static const List<String> _kEnhanceStyleKeys = <String>[
    'ai',
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
  String? _enhanceError;

  String _aiStyleFor(RankedPhoto ranked) {
    final score = ranked.score;
    final t = '${ranked.improvementTip}\n${ranked.reason}'.toLowerCase();
    final hasLight = t.contains('light') ||
        t.contains('lighting') ||
        t.contains('曝光') ||
        t.contains('过曝') ||
        t.contains('欠曝') ||
        t.contains('太暗') ||
        t.contains('太亮') ||
        t.contains('光线') ||
        t.contains('阴影');
    if (hasLight) return 'natural_glow';
    if (score >= 85) return 'portrait';
    if (score >= 75) return 'natural_glow';
    if (score >= 65) return 'soft_feminine';
    return 'luxury_studio';
  }

  Future<void> _pickAndAnalyze() async {
    final picker = ImagePicker();
    final x = await picker.pickImage(source: ImageSource.gallery, imageQuality: 95);
    if (x == null) return;
    final file = File(x.path);

    // 重置本次会话状态
    ref.read(photoProvider.notifier).clear();
    ref.read(photoProvider.notifier).add(file, maxPhotos: 1);
    ref.read(analysisResultProvider.notifier).state = null;
    ref.read(analysisErrorProvider.notifier).state = null;
    ref.read(analysisLoadingProvider.notifier).state = false;
    ref.read(enhanceUrlByIndexProvider.notifier).state = <int, String>{};
    ref.read(enhanceLoadingByIndexProvider.notifier).state = <int, bool>{};
    ref.read(enhanceSessionIdProvider.notifier).state = null;
    setState(() {
      _enhanceError = null;
      _style = 'portrait';
    });

    // 自动评分
    await ref.read(enhanceAnalyzeProvider)();
  }

  RankedPhoto? _rankedForSingle(WidgetRef ref) {
    final result = ref.watch(analysisResultProvider);
    if (result == null) return null;
    return result.rankedPhotos
        .where((r) => r.index == 0)
        .cast<RankedPhoto?>()
        .firstOrNull;
  }

  @override
  Widget build(BuildContext context) {
    final photos = ref.watch(photoProvider);
    final photo = photos.isNotEmpty ? photos.first.file : null;
    final analyzing = ref.watch(analysisLoadingProvider);
    final analyzeError = ref.watch(analysisErrorProvider);
    final ranked = _rankedForSingle(ref);

    final enhanceUrl = ref.watch(enhanceUrlByIndexProvider)[0];
    final enhancing = ref.watch(enhanceLoadingByIndexProvider)[0] == true;

    return Scaffold(
      backgroundColor: appSurfaceDark,
      appBar: AppBar(
        title: Text(
          AppStrings.resultEnhancement,
          style: GoogleFonts.merriweather(fontWeight: FontWeight.w600),
        ),
        centerTitle: true,
        actions: [
          IconButton(
            tooltip: '历史',
            icon: Icon(Icons.history, color: Colors.white),
            onPressed: () => Navigator.of(context).pushNamed('/enhance/history'),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                AppStrings.selectPhoto,
                style: GoogleFonts.inter(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: appCreamWhite,
                ),
              ),
              FilledButton.icon(
                onPressed: analyzing || enhancing ? null : _pickAndAnalyze,
                icon: const Icon(Icons.photo_library_outlined, size: 18),
                label: Text(AppStrings.selectPhoto),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (photo == null)
            _Card(
              child: Row(
                children: [
                  Icon(Icons.photo, color: appCreamGold),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      '选择一张照片后将自动评分，并可直接在此页面美化。',
                      style: GoogleFonts.inter(color: appLightGray, fontSize: 12),
                    ),
                  ),
                ],
              ),
            )
          else
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Image.file(
                photo,
                height: 240,
                width: double.infinity,
                fit: BoxFit.cover,
              ),
            ),
          const SizedBox(height: 14),
          Text(
            '评分结果',
            style: GoogleFonts.inter(
              color: appCreamWhite,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          if (photo != null && analyzing)
            _Card(
              child: Row(
                children: [
                  const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text(
                      '正在评分…',
                      style: GoogleFonts.inter(color: appLightGray, fontSize: 12),
                    ),
                  ),
                ],
              ),
            )
          else if (photo != null && analyzeError != null)
            _Card(
              child: Text(
                analyzeError,
                style: GoogleFonts.inter(color: Colors.red.shade200, fontSize: 12),
              ),
            )
          else if (photo != null && ranked != null)
            _Card(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '评分：${ranked.score} / 100',
                    style: GoogleFonts.inter(
                      color: appCreamGold,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(height: 8),
                  if (ranked.swipeProbability > 0)
                    _Line(title: 'Swipe 概率', value: '${ranked.swipeProbability}%'),
                  if (ranked.firstImpressionPrediction.trim().isNotEmpty)
                    _Line(title: '第一印象', value: ranked.firstImpressionPrediction),
                  if (ranked.improvementTip.trim().isNotEmpty)
                    _Line(title: '建议', value: ranked.improvementTip),
                ],
              ),
            )
          else
            _Card(
              child: Text(
                '上传后会在这里展示评分与建议。',
                style: GoogleFonts.inter(color: appLightGray, fontSize: 12),
              ),
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
                    .where((k) => k != 'ai' || ranked != null)
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
                onChanged: (photo == null || analyzing || enhancing)
                    ? null
                    : (v) => setState(() => _style = v ?? _style),
              ),
            ),
          ),
          const SizedBox(height: 12),
          if (ranked == null)
            Text(
              '评分完成后将解锁「AI 美化（推荐）」。',
              style: GoogleFonts.inter(color: appLightGray, fontSize: 12),
            )
          else if (_style == 'ai')
            Text(
              'AI 美化将根据评分与建议自动选择最合适的风格。',
              style: GoogleFonts.inter(color: appLightGray, fontSize: 12),
            ),
          if (ranked == null || _style != 'ai') const SizedBox(height: 0) else const SizedBox(height: 6),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: (photo == null || ranked == null || analyzing || enhancing)
                  ? null
                  : () async {
                      setState(() => _enhanceError = null);
                      try {
                        final styleToUse =
                            (_style == 'ai') ? _aiStyleFor(ranked) : _style;
                        await ref.read(enhancePhotoProvider)(
                          photoIndex: 0,
                          style: styleToUse,
                        );
                      } catch (e) {
                        setState(() => _enhanceError =
                            e.toString().replaceFirst(RegExp(r'^.*?Exception:?\s*'), ''));
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
              child: enhancing
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
          if (_enhanceError != null) ...[
            const SizedBox(height: 10),
            _Card(
              child: Text(
                _enhanceError!,
                style: GoogleFonts.inter(color: Colors.red.shade200, fontSize: 12),
              ),
            ),
          ],
          const SizedBox(height: 18),
          Text(
            AppStrings.result,
            style: GoogleFonts.inter(
              color: appCreamWhite,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          if (enhanceUrl == null)
            _Card(
              child: Text(
                '美化完成后会在这里展示结果图。',
                style: GoogleFonts.inter(color: appLightGray, fontSize: 12),
              ),
            )
          else
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Image.network(
                enhanceUrl,
                height: 320,
                width: double.infinity,
                fit: BoxFit.cover,
                errorBuilder: (_, __, ___) => _Card(
                  child: Text(
                    AppStrings.enhancedVersionError,
                    style: GoogleFonts.inter(color: appLightGray, fontSize: 12),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _Card extends StatelessWidget {
  final Widget child;
  const _Card({required this.child});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: appSurfaceCard,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.06)),
      ),
      child: child,
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
            width: 72,
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

