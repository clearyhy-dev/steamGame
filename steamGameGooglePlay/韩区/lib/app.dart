import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'core/theme/app_theme.dart';
import 'dart:io';

import 'features/analysis/analysis_screen.dart';
import 'features/background/background_choose_screen.dart';
import 'features/background/background_select_screen.dart';
import 'features/background/extracted_person_screen.dart';
import 'features/enhance/enhance_analysis_screen.dart';
import 'features/enhance/enhance_composition_screen.dart';
import 'features/enhance/enhance_history_entry_screen.dart';
import 'features/enhance/enhance_history_screen.dart';
import 'features/enhance/enhance_one_page_screen.dart';
import 'features/enhance/enhance_photo_screen.dart';
import 'features/enhance/enhance_result_screen.dart';
import 'features/headwear/hat_screen.dart';
import 'features/history/history_screen.dart';
import 'features/home/home_screen.dart';
import 'features/paywall/paywall_screen.dart';
import 'features/result/result_screen.dart';
import 'features/upload/upload_screen.dart';

class MatchMuseApp extends StatelessWidget {
  const MatchMuseApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ProviderScope(
      child: MaterialApp(
        title: 'AI Feminine Presence Studio',
        theme: appTheme,
        initialRoute: '/',
        routes: {
          '/': (context) => const HomeScreen(),
          '/upload': (context) => const UploadScreen(),
          '/analysis': (context) => const AnalysisScreen(),
          '/result': (context) => const ResultScreen(),
          '/paywall': (context) => const PaywallScreen(),
          // 图片美化模块：上传/分析/结果/单张美化/历史
          '/enhance': (context) => const EnhanceOnePageScreen(),
          '/enhance/analysis': (context) => const EnhanceAnalysisScreen(),
          '/enhance/result': (context) => const EnhanceResultScreen(),
          '/enhance/history': (context) => const EnhanceHistoryScreen(),
          '/enhance/history-entry': (context) {
            final args = ModalRoute.of(context)?.settings.arguments;
            final entry = args is Map<String, dynamic>
                ? args
                : (args is Map ? Map<String, dynamic>.from(args) : <String, dynamic>{});
            return EnhanceHistoryEntryScreen(entry: entry);
          },
          '/enhance/composition': (context) {
            final args = ModalRoute.of(context)?.settings.arguments;
            final index = args is int ? args : int.tryParse(args?.toString() ?? '') ?? 0;
            return EnhanceCompositionScreen(photoIndex: index);
          },
          '/enhance/photo': (context) {
            final args = ModalRoute.of(context)?.settings.arguments;
            final index = args is int ? args : int.tryParse(args?.toString() ?? '') ?? 0;
            return EnhancePhotoScreen(photoIndex: index);
          },
          '/background-select': (context) => const BackgroundSelectScreen(),
          '/background-choose': (context) => const BackgroundChooseScreen(),
          '/hat': (context) {
            final args = ModalRoute.of(context)?.settings.arguments;
            return HatScreen(initialImage: args is File ? args : null);
          },
          '/history': (context) => const HistoryScreen(),
        },
      ),
    );
  }
}
