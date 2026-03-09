import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/localization/app_strings.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/app_providers.dart';
import '../../services/storage_service.dart';

class EnhanceHistoryEntryScreen extends ConsumerStatefulWidget {
  const EnhanceHistoryEntryScreen({super.key, required this.entry});

  final Map<String, dynamic> entry;

  @override
  ConsumerState<EnhanceHistoryEntryScreen> createState() =>
      _EnhanceHistoryEntryScreenState();
}

class _EnhanceHistoryEntryScreenState
    extends ConsumerState<EnhanceHistoryEntryScreen> {
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

  bool _loading = false;
  String _style = 'portrait';
  String? _enhancedUrl;
  String? _error;

  @override
  void initState() {
    super.initState();
    final s = widget.entry['enhanceStyle']?.toString();
    if (s != null && s.isNotEmpty) _style = s;
    final u = widget.entry['enhancedUrl']?.toString();
    if (u != null && u.isNotEmpty) _enhancedUrl = u;
  }

  Future<void> _enhance() async {
    final path = widget.entry['photoPath']?.toString();
    if (path == null || path.isEmpty) {
      setState(() => _error = '找不到原图路径');
      return;
    }
    final file = File(path);
    if (!await file.exists()) {
      setState(() => _error = '原图文件不存在或无权限访问');
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final uid = await ref.read(uidProvider.future);
      final base64 = await compressAndEncode(file, maxWidth: 1280, quality: 86);
      final api = ref.read(apiServiceProvider);
      final url = await api.enhance(
        uid: uid,
        bestPhotoBase64: base64,
        promptStyle: _style,
      );
      final entryId = widget.entry['id']?.toString() ?? '';
      if (entryId.isNotEmpty) {
        await StorageService.setAnalysisHistoryEnhanceResult(
          uid: uid,
          entryId: entryId,
          enhancedUrl: url,
          style: _style,
        );
        ref.invalidate(enhanceAnalysisHistoryProvider);
      }
      setState(() => _enhancedUrl = url);
    } catch (e) {
      setState(() => _error =
          e.toString().replaceFirst(RegExp(r'^.*?Exception:?\s*'), ''));
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final score = widget.entry['score']?.toString() ?? '';
    final tip = widget.entry['improvementTip']?.toString() ?? '';
    final reason = widget.entry['reason']?.toString() ?? '';
    final first = widget.entry['firstImpressionPrediction']?.toString() ?? '';
    final swipe = widget.entry['swipeProbability']?.toString() ?? '';
    final path = widget.entry['photoPath']?.toString();
    final file = (path != null && path.isNotEmpty) ? File(path) : null;

    return Scaffold(
      backgroundColor: appSurfaceDark,
      appBar: AppBar(
        title: Text(
          '历史详情',
          style: GoogleFonts.merriweather(fontWeight: FontWeight.w600),
        ),
        centerTitle: true,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: (file != null && file.existsSync())
                ? Image.file(file,
                    height: 240, width: double.infinity, fit: BoxFit.cover)
                : Container(
                    height: 240,
                    color: Colors.white12,
                    child: Icon(Icons.photo, color: appLightGray, size: 48),
                  ),
          ),
          const SizedBox(height: 12),
          Container(
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
                  score.isEmpty ? '评分记录' : '评分：$score / 100',
                  style: GoogleFonts.inter(
                    color: appCreamGold,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 8),
                if (first.trim().isNotEmpty) _Line(title: '第一印象', value: first),
                if (swipe.isNotEmpty && swipe != '0')
                  _Line(title: 'Swipe 概率', value: '$swipe%'),
                if (reason.trim().isNotEmpty) _Line(title: '原因', value: reason),
                if (tip.trim().isNotEmpty) _Line(title: '建议', value: tip),
              ],
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
                onChanged: _loading ? null : (v) => setState(() => _style = v ?? _style),
              ),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _loading ? null : _enhance,
              style: ElevatedButton.styleFrom(
                backgroundColor: appCreamGold,
                foregroundColor: Colors.black,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: _loading
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
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(
              _error!,
              style: GoogleFonts.inter(color: Colors.red.shade200, fontSize: 12),
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
          if (_enhancedUrl == null)
            Container(
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: appSurfaceCard,
                borderRadius: BorderRadius.circular(14),
                border: Border.all(color: Colors.white.withOpacity(0.06)),
              ),
              child: Text(
                '美化完成后会在这里展示结果图。',
                style: GoogleFonts.inter(color: appLightGray, fontSize: 12),
              ),
            )
          else
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Image.network(
                _enhancedUrl!,
                height: 320,
                width: double.infinity,
                fit: BoxFit.cover,
              ),
            ),
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

