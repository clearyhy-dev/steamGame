import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/theme/app_theme.dart';
import '../../services/storage_service.dart';

/// 欧美女性专版历史记录
/// 可查看、重新下载
class HistoryScreen extends StatelessWidget {
  const HistoryScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final items = StorageService.history;

    return Scaffold(
      backgroundColor: appSurfaceDark,
      appBar: AppBar(
        title: Text(
          'Your Presence History',
          style: GoogleFonts.playfairDisplay(
            fontWeight: FontWeight.w600,
            color: appCreamWhite,
          ),
        ),
        centerTitle: true,
        leading: IconButton(
          icon: Icon(Icons.arrow_back, color: appCreamWhite),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: items.isEmpty
          ? Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(Icons.photo_library_outlined,
                      size: 64, color: appLightGray),
                  const SizedBox(height: 16),
                  Text(
                    'No results yet',
                    style: GoogleFonts.playfairDisplay(
                      fontSize: 18,
                      color: appCreamWhite,
                    ),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Upload photos and analyze to see your history',
                    style: GoogleFonts.inter(color: appLightGray, fontSize: 14),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            )
          : ListView.builder(
              padding: const EdgeInsets.all(16),
              itemCount: items.length,
              itemBuilder: (_, i) {
                final e = items[i];
                final url = e['url'] as String? ?? '';
                final score = (e['score'] as num?)?.toInt() ?? 0;
                final ts = e['ts'] as String? ?? '';
                DateTime? date;
                try {
                  date = DateTime.tryParse(ts);
                } catch (_) {}
                final dateStr = date != null
                    ? '${date.month}/${date.day}'
                    : '';

                return Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: GestureDetector(
                    onTap: () => _showDetail(context, url, score, dateStr),
                    child: Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: appSurfaceCard,
                        borderRadius: BorderRadius.circular(24),
                        border: Border.all(color: Colors.white12),
                      ),
                      child: Row(
                        children: [
                          ClipRRect(
                            borderRadius: BorderRadius.circular(16),
                            child: url.isNotEmpty
                                ? Image.network(
                                    url,
                                    width: 72,
                                    height: 72,
                                    fit: BoxFit.cover,
                                    errorBuilder: (_, __, ___) => Container(
                                      width: 72,
                                      height: 72,
                                      color: appSurfaceDark,
                                      child: Icon(
                                        Icons.image_not_supported,
                                        color: appLightGray,
                                      ),
                                    ),
                                  )
                                : Container(
                                    width: 72,
                                    height: 72,
                                    color: appSurfaceDark,
                                    child: Icon(
                                      Icons.photo_outlined,
                                      color: appLightGray,
                                    ),
                                  ),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'Presence Score: $score',
                                  style: GoogleFonts.playfairDisplay(
                                    fontSize: 16,
                                    fontWeight: FontWeight.w600,
                                    color: appCreamGold,
                                  ),
                                ),
                                if (dateStr.isNotEmpty) ...[
                                  const SizedBox(height: 4),
                                  Text(
                                    dateStr,
                                    style: GoogleFonts.inter(
                                      fontSize: 13,
                                      color: appLightGray,
                                    ),
                                  ),
                                ],
                              ],
                            ),
                          ),
                          Icon(
                            Icons.chevron_right,
                            color: appLightGray,
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
    );
  }

  void _showDetail(
    BuildContext context,
    String url,
    int score,
    String dateStr,
  ) {
    showModalBottomSheet(
      context: context,
      backgroundColor: appSurfaceCard,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (url.isNotEmpty)
                ClipRRect(
                  borderRadius: BorderRadius.circular(16),
                  child: Image.network(
                    url,
                    height: 280,
                    width: double.infinity,
                    fit: BoxFit.cover,
                    errorBuilder: (_, __, ___) => Container(
                      height: 200,
                      color: appSurfaceDark,
                      child: Icon(Icons.image_not_supported,
                          size: 48, color: appLightGray),
                    ),
                  ),
                ),
              const SizedBox(height: 16),
              Text(
                'Score: $score',
                style: GoogleFonts.playfairDisplay(
                  fontSize: 20,
                  fontWeight: FontWeight.bold,
                  color: appCreamGold,
                ),
              ),
              if (dateStr.isNotEmpty)
                Text(
                  dateStr,
                  style: GoogleFonts.inter(color: appLightGray, fontSize: 14),
                ),
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: TextButton.icon(
                  onPressed: () => Navigator.of(ctx).pop(),
                  icon: Icon(Icons.close, color: appCreamGold),
                  label: Text('Close', style: TextStyle(color: appCreamGold)),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
