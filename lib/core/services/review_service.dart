import 'package:flutter/material.dart';
import 'package:in_app_review/in_app_review.dart';

import '../../l10n/app_localizations.dart';
import '../constants.dart';
import '../storage_service.dart';
import '../theme/colors.dart';
import 'analytics_service.dart';

/// 评分：启动/愿望单触发用系统评价；个人中心先选星级，低分仅后端记录，4–5 星再走 Google。
class ReviewService {
  static final ReviewService _instance = ReviewService._internal();
  factory ReviewService() => _instance;
  ReviewService._internal();

  final InAppReview _review = InAppReview.instance;

  /// 应用启动时检查（第 3 次打开触发）
  Future<void> checkAndRequestReviewOnLaunch() async {
    final storage = StorageService.instance;
    if (!storage.isInitialized) await storage.init();
    final launchCount = await storage.getAppOpenCount();
    final hasReviewed = await storage.getHasReviewed();
    if (launchCount >= AppConstants.reviewTriggerLaunchCount && !hasReviewed) {
      await _requestReview(storage);
    }
  }

  /// 加入愿望单后调用
  Future<void> checkAndRequestReviewAfterWishlistAdd() async {
    final storage = StorageService.instance;
    if (!storage.isInitialized) await storage.init();
    final hasReviewed = await storage.getHasReviewed();
    if (hasReviewed) return;
    await _requestReview(storage);
  }

  /// 个人中心「给我们评分」：先选 1–5 星；1–3 仅埋点+后端；4–5 调起 Google 应用内评价（不可用时打开商店页）。
  Future<void> promptRatingFromProfile(BuildContext context) async {
    final storage = StorageService.instance;
    if (!storage.isInitialized) await storage.init();

    final stars = await showDialog<int>(
      context: context,
      builder: (ctx) => const _StarRatingDialog(),
    );
    if (stars == null || stars < 1 || stars > 5) return;

    final submitToStore = stars >= 4;
    await AnalyticsService.instance.logAppRatingStars(stars: stars, submitToStore: submitToStore);

    if (!context.mounted) return;
    final l10n = AppLocalizations.of(context);

    if (stars <= 3) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.get('rate_thanks_low'))),
      );
      return;
    }

    await _openGoogleReview(storage);

    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.get('rate_thanks_high'))),
      );
    }
  }

  Future<void> _openGoogleReview(StorageService storage) async {
    try {
      if (await _review.isAvailable()) {
        await _review.requestReview();
      } else {
        await _review.openStoreListing();
      }
      await storage.setHasReviewed(true);
    } catch (e, st) {
      debugPrint('InAppReview: $e\n$st');
      try {
        await _review.openStoreListing();
        await storage.setHasReviewed(true);
      } catch (e2) {
        debugPrint('openStoreListing: $e2');
      }
    }
  }

  Future<void> _requestReview(StorageService storage) async {
    if (!await _review.isAvailable()) return;
    await _review.requestReview();
    await storage.setHasReviewed(true);
  }
}

class _StarRatingDialog extends StatefulWidget {
  const _StarRatingDialog();

  @override
  State<_StarRatingDialog> createState() => _StarRatingDialogState();
}

class _StarRatingDialogState extends State<_StarRatingDialog> {
  int _selected = 0;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return AlertDialog(
      backgroundColor: AppColors.cardDark,
      title: Text(
        l10n.get('rate_dialog_title'),
        style: const TextStyle(color: AppColors.textPrimary, fontWeight: FontWeight.w600),
      ),
      content: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: List.generate(5, (i) {
          final n = i + 1;
          return IconButton(
            onPressed: () => setState(() => _selected = n),
            icon: Icon(
              n <= _selected ? Icons.star_rounded : Icons.star_outline_rounded,
              color: AppColors.gold,
              size: 36,
            ),
          );
        }),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.pop(context),
          child: Text(l10n.get('later')),
        ),
        FilledButton(
          onPressed: _selected > 0 ? () => Navigator.pop(context, _selected) : null,
          child: Text(l10n.get('rate_submit')),
        ),
      ],
    );
  }
}
