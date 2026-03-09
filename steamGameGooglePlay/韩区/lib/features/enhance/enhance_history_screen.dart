import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/theme/app_theme.dart';
import '../../providers/app_providers.dart';

class EnhanceHistoryScreen extends ConsumerWidget {
  const EnhanceHistoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final historyAsync = ref.watch(enhanceAnalysisHistoryProvider);

    return Scaffold(
      backgroundColor: appSurfaceDark,
      appBar: AppBar(
        title: Text(
          '分析历史',
          style: GoogleFonts.merriweather(fontWeight: FontWeight.w600),
        ),
        centerTitle: true,
      ),
      body: historyAsync.when(
        data: (list) {
          if (list.isEmpty) {
            return Center(
              child: Text(
                '暂无历史记录',
                style: GoogleFonts.inter(color: appLightGray),
              ),
            );
          }
          return ListView.builder(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
            itemCount: list.length,
            itemBuilder: (_, i) {
              final e = list[i];
              final score = e['score']?.toString() ?? '';
              final path = e['photoPath']?.toString();
              final tip = e['improvementTip']?.toString() ?? '';
              final enhancedUrl = e['enhancedUrl']?.toString();
              final ts = e['ts']?.toString() ?? '';
              final file = (path != null && path.isNotEmpty) ? File(path) : null;
              return GestureDetector(
                onTap: () => Navigator.of(context).pushNamed(
                  '/enhance/history-entry',
                  arguments: e,
                ),
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
                        child: (file != null && file.existsSync())
                            ? Image.file(file,
                                width: 72, height: 72, fit: BoxFit.cover)
                            : Container(
                                width: 72,
                                height: 72,
                                color: Colors.white12,
                                child: Icon(Icons.photo, color: appLightGray),
                              ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              score.isEmpty ? '评分记录' : '评分：$score / 100',
                              style: GoogleFonts.inter(
                                color: appCreamWhite,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 6),
                            if (tip.trim().isNotEmpty)
                              Text(
                                tip,
                                maxLines: 2,
                                overflow: TextOverflow.ellipsis,
                                style: GoogleFonts.inter(
                                    color: appLightGray, fontSize: 12),
                              ),
                            const SizedBox(height: 6),
                            Text(
                              enhancedUrl != null && enhancedUrl.isNotEmpty
                                  ? '已美化'
                                  : '未美化',
                              style: GoogleFonts.inter(
                                color:
                                    enhancedUrl != null && enhancedUrl.isNotEmpty
                                        ? appCreamGold
                                        : appLightGray,
                                fontSize: 12,
                              ),
                            ),
                            if (ts.isNotEmpty)
                              Text(
                                ts,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: GoogleFonts.inter(
                                    color: Colors.white38, fontSize: 10),
                              ),
                          ],
                        ),
                      ),
                      Icon(Icons.chevron_right, color: appLightGray),
                    ],
                  ),
                ),
              );
            },
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, _) => Center(
          child: Text(
            err.toString(),
            style: GoogleFonts.inter(color: Colors.red.shade200),
          ),
        ),
      ),
    );
  }
}

