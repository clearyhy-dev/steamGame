import 'package:flutter/foundation.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

import 'ad_config.dart';
import 'constants.dart';
import 'services/analytics_service.dart';
import 'storage_service.dart';

/// 插屏：预加载、展示、失败重试、[dispose]；每日次数在成功展示后计入。
class InterstitialAdService {
  InterstitialAdService._();
  static final InterstitialAdService instance = InterstitialAdService._();

  InterstitialAd? _ad;
  bool _loading = false;
  int _retryCount = 0;
  static const int _maxLoadRetries = 2;

  Future<void> maybeShowAfterDetailView() async {
    if (!AdConfig.adsEnabledByPolicy) return;
    final storage = StorageService.instance;
    if (!storage.isInitialized) await storage.init();
    if (await storage.isPro()) return;

    await storage.incrementDetailViewCount();
    final count = await storage.getDetailViewCount();
    if (count % 5 != 0) return;

    final today = await storage.getTodayInterstitialCount();
    if (today >= AppConstants.maxInterstitialsPerDay) return;

    await _loadAndShow(source: 'detail_view');
  }

  Future<void> maybeShowAfterWishlistAdd() async {
    if (!AdConfig.adsEnabledByPolicy) return;
    final storage = StorageService.instance;
    if (!storage.isInitialized) await storage.init();
    if (await storage.isPro()) return;

    final today = await storage.getTodayInterstitialCount();
    if (today >= AppConstants.maxInterstitialsPerDay) return;

    await _loadAndShow(source: 'wishlist_add');
  }

  Future<void> _loadAndShow({required String source}) async {
    if (_loading) return;
    _loading = true;
    _retryCount = 0;
    await _loadAttempt(source: source);
  }

  Future<void> _loadAttempt({required String source}) async {
    final unitId = AdConfig.interstitialAdUnitId;
    InterstitialAd.load(
      adUnitId: unitId,
      request: const AdRequest(),
      adLoadCallback: InterstitialAdLoadCallback(
        onAdLoaded: (ad) {
          _loading = false;
          _ad = ad;
          _retryCount = 0;
          ad.fullScreenContentCallback = FullScreenContentCallback(
            onAdShowedFullScreenContent: (ad) {
              AnalyticsService.instance.logAdImpression(
                adUnitId: unitId,
                adFormat: 'interstitial',
                placement: source,
              );
            },
            onAdDismissedFullScreenContent: (ad) async {
              ad.dispose();
              _ad = null;
              try {
                await StorageService.instance.incrementTodayInterstitialCount();
              } catch (_) {}
            },
            onAdFailedToShowFullScreenContent: (ad, err) {
              debugPrint('Interstitial show failed: $err');
              ad.dispose();
              _ad = null;
              _loading = false;
            },
          );
          ad.show();
        },
        onAdFailedToLoad: (err) {
          debugPrint('Interstitial load failed: $err');
          AnalyticsService.instance.logAdLoadFailed(
            adUnitId: unitId,
            adFormat: 'interstitial',
            placement: source,
            errorCode: err.code.toString(),
          );
          if (_retryCount < _maxLoadRetries) {
            _retryCount++;
            Future<void>.microtask(() => _loadAttempt(source: source));
          } else {
            _loading = false;
            _retryCount = 0;
          }
        },
      ),
    );
  }

  void disposeCurrent() {
    _ad?.dispose();
    _ad = null;
    _loading = false;
  }
}
