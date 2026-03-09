import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/localization/app_strings.dart';
import '../../core/theme/app_theme.dart';
import '../../models/photo_model.dart';
import '../../providers/app_providers.dart';

/// 图片美化模块：评分结果页（按单张图查看分析并做美化）
class EnhanceResultScreen extends ConsumerWidget {
  const EnhanceResultScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final result = ref.watch(analysisResultProvider);
    final photos = ref.watch(photoProvider);

    if (result == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (context.mounted) {
          Navigator.of(context).pushReplacementNamed('/enhance');
        }
      });
      return Scaffold(
        backgroundColor: appSurfaceDark,
        body: Center(
          child: Text(
            AppStrings.loadingResults,
            style: GoogleFonts.inter(color: Colors.white70),
          ),
        ),
      );
    }

    return Scaffold(
      backgroundColor: appSurfaceDark,
      appBar: AppBar(
        title: Text(
          '评分结果',
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
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
        children: [
          Text(
            '点击某张照片，查看分析结果并进行美化。',
            style: GoogleFonts.inter(color: appLightGray, fontSize: 13),
          ),
          const SizedBox(height: 12),
          ...result.rankedPhotos.map((r) {
            final File? file =
                (r.index >= 0 && r.index < photos.length) ? photos[r.index].file : null;
            return _RankedPhotoCard(
              ranked: r,
              file: file,
              onTap: () => Navigator.of(context).pushNamed(
                '/enhance/photo',
                arguments: r.index,
              ),
            );
          }),
          const SizedBox(height: 12),
          TextButton.icon(
            onPressed: () => Navigator.of(context).pushReplacementNamed('/enhance'),
            icon: Icon(Icons.add_photo_alternate_outlined, color: appLightGray),
            label: Text(
              '重新上传并评分',
              style: GoogleFonts.inter(color: appLightGray),
            ),
          ),
        ],
      ),
    );
  }
}

class _RankedPhotoCard extends StatelessWidget {
  final RankedPhoto ranked;
  final File? file;
  final VoidCallback onTap;

  const _RankedPhotoCard({
    required this.ranked,
    required this.file,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: 12),
        padding: const EdgeInsets.all(12),
        decoration: BoxDecoration(
          color: appSurfaceCard,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: Colors.white.withOpacity(0.06)),
        ),
        child: Row(
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: file == null
                  ? Container(
                      width: 84,
                      height: 84,
                      color: Colors.white12,
                      child: Icon(Icons.image_not_supported,
                          color: appLightGray),
                    )
                  : Image.file(
                      file!,
                      width: 84,
                      height: 84,
                      fit: BoxFit.cover,
                    ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '照片 #${ranked.index + 1}',
                    style: GoogleFonts.inter(
                      color: appCreamWhite,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    '评分：${ranked.score} / 100',
                    style: GoogleFonts.inter(color: appCreamGold),
                  ),
                  if (ranked.improvementTip.trim().isNotEmpty) ...[
                    const SizedBox(height: 6),
                    Text(
                      ranked.improvementTip,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: GoogleFonts.inter(color: appLightGray, fontSize: 12),
                    ),
                  ],
                ],
              ),
            ),
            Icon(Icons.chevron_right, color: appLightGray),
          ],
        ),
      ),
    );
  }
}

