import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

import 'ad_config.dart';
import 'services/analytics_service.dart';
import 'storage_service.dart';

/// 「以最优价购买」前展示激励视频；用户获得奖励后才执行 [onRewardGranted]。
class RewardedAffiliateAdService {
  RewardedAffiliateAdService._();
  static final RewardedAffiliateAdService instance = RewardedAffiliateAdService._();

  /// Pro 或关闭广告策略时直接执行购买逻辑，不展示广告。
  Future<void> runPurchaseAfterRewardedAd({
    required Future<void> Function() onRewardGranted,
    required void Function(String l10nKey) onAdBlocked,
  }) async {
    if (!AdConfig.adsEnabledByPolicy) {
      await onRewardGranted();
      return;
    }
    final storage = StorageService.instance;
    if (!storage.isInitialized) await storage.init();
    if (await storage.isPro()) {
      await onRewardGranted();
      return;
    }

    final unitId = AdConfig.rewardedAdUnitId;
    final completer = Completer<void>();
    var finished = false;

    void finish() {
      if (finished) return;
      finished = true;
      if (!completer.isCompleted) completer.complete();
    }

    RewardedAd.load(
      adUnitId: unitId,
      request: const AdRequest(),
      rewardedAdLoadCallback: RewardedAdLoadCallback(
        onAdLoaded: (RewardedAd ad) {
          var rewardEarned = false;
          ad.fullScreenContentCallback = FullScreenContentCallback(
            onAdShowedFullScreenContent: (ad) {
              unawaited(
                AnalyticsService.instance.logAdImpression(
                  adUnitId: unitId,
                  adFormat: 'rewarded',
                  placement: 'affiliate_buy_best_price',
                ),
              );
            },
            onAdDismissedFullScreenContent: (ad) {
              ad.dispose();
              if (!rewardEarned) finish();
            },
            onAdFailedToShowFullScreenContent: (ad, err) {
              debugPrint('Rewarded show failed: $err');
              ad.dispose();
              onAdBlocked('affiliate_rewarded_show_failed');
              finish();
            },
          );
          ad.show(
            onUserEarnedReward: (ad, reward) async {
              rewardEarned = true;
              try {
                await onRewardGranted();
              } finally {
                finish();
              }
            },
          );
        },
        onAdFailedToLoad: (err) {
          debugPrint('Rewarded load failed: $err');
          unawaited(
            AnalyticsService.instance.logAdLoadFailed(
              adUnitId: unitId,
              adFormat: 'rewarded',
              placement: 'affiliate_buy_best_price',
              errorCode: err.code.toString(),
            ),
          );
          onAdBlocked('affiliate_rewarded_load_failed');
          finish();
        },
      ),
    );

    return completer.future;
  }
}
