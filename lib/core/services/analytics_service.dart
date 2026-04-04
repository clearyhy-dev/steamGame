import 'dart:async';

import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:flutter/foundation.dart';

import '../storage_service.dart';
import '../../services/steam_backend_service.dart';

/// Firebase Analytics 统一埋点；若已登录后端则同步镜像至 `/v1/events/*`（服务端落日志，可接数仓）。
class AnalyticsService {
  AnalyticsService._();
  static final AnalyticsService instance = AnalyticsService._();

  final FirebaseAnalytics _analytics = FirebaseAnalytics.instance;
  static final SteamBackendService _backendEvents = SteamBackendService();

  Future<void> _mirror(String path, String eventName, Map<String, Object> params) async {
    try {
      if (!StorageService.instance.isInitialized) {
        await StorageService.instance.init();
      }
      final token = await StorageService.instance.getSteamBackendToken();
      if (token == null || token.isEmpty) return;
      final body = <String, dynamic>{'event': eventName};
      for (final e in params.entries) {
        body[e.key] = e.value;
      }
      await _backendEvents.postAnalyticsEvent(token, path, body);
    } catch (_) {}
  }

  Future<void> logPaywallView({required String source}) async {
    final p = <String, Object>{'source': source};
    await _safeLog('view_paywall', p);
    unawaited(_mirror('exposure', 'view_paywall', p));
  }

  Future<void> logSubscriptionPlanSelect({
    required String productId,
    required String source,
  }) async {
    final p = <String, Object>{
      'product_id': productId,
      'source': source,
    };
    await _safeLog('select_subscription_plan', p);
    unawaited(_mirror('click', 'select_subscription_plan', p));
  }

  Future<void> logBeginCheckout({
    required String productId,
    required double value,
    required String currency,
    required String source,
  }) async {
    final p = <String, Object>{
      'product_id': productId,
      'value': value,
      'currency': currency,
      'source': source,
    };
    await _safeLog('begin_checkout', p);
    unawaited(_mirror('click', 'begin_checkout', p));
  }

  Future<void> logPurchase({
    required String productId,
    required double value,
    required String currency,
    String? transactionId,
    required String source,
  }) async {
    final p = <String, Object>{
      'product_id': productId,
      'value': value,
      'currency': currency,
      'source': source,
      if (transactionId != null && transactionId.isNotEmpty) 'transaction_id': transactionId,
    };
    await _safeLog('purchase', p);
    unawaited(_mirror('conversion', 'purchase', p));
  }

  Future<void> logRestore({
    required bool success,
    required String source,
  }) async {
    final p = <String, Object>{
      'success': success ? 1 : 0,
      'source': source,
    };
    await _safeLog('restore_purchase', p);
    unawaited(_mirror('click', 'restore_purchase', p));
  }

  Future<void> logAdImpression({
    required String adUnitId,
    required String adFormat,
    required String placement,
  }) async {
    final p = <String, Object>{
      'ad_unit_id': adUnitId,
      'ad_format': adFormat,
      'placement': placement,
    };
    await _safeLog('ad_impression', p);
    unawaited(_mirror('exposure', 'ad_impression', p));
  }

  Future<void> logAdClick({
    required String adUnitId,
    required String adFormat,
    required String placement,
  }) async {
    final p = <String, Object>{
      'ad_unit_id': adUnitId,
      'ad_format': adFormat,
      'placement': placement,
    };
    await _safeLog('ad_click', p);
    unawaited(_mirror('click', 'ad_click', p));
  }

  Future<void> logAppOpen({required String source}) async {
    final p = <String, Object>{'source': source};
    await _safeLog('app_open', p);
    unawaited(_mirror('exposure', 'app_open', p));
  }

  Future<void> logRecommendationImpression({
    required String section,
    required String steamAppId,
    required List<String> reasonCodes,
  }) async {
    final p = <String, Object>{
      'section': section,
      'steam_app_id': steamAppId,
      'reason_codes': reasonCodes.join(','),
    };
    await _safeLog('recommendation_impression', p);
    unawaited(_mirror('exposure', 'recommendation_impression', p));
  }

  Future<void> logRecommendationClick({
    required String section,
    required String steamAppId,
    required List<String> reasonCodes,
  }) async {
    final p = <String, Object>{
      'section': section,
      'steam_app_id': steamAppId,
      'reason_codes': reasonCodes.join(','),
    };
    await _safeLog('recommendation_click', p);
    unawaited(_mirror('click', 'recommendation_click', p));
  }

  Future<void> logSteamLinkClick({required String source}) async {
    final p = <String, Object>{'source': source};
    await _safeLog('steam_link_click', p);
    unawaited(_mirror('click', 'steam_link_click', p));
  }

  Future<void> logSteamLinkSuccess() async {
    const p = <String, Object>{};
    await _safeLog('steam_link_success', p);
    unawaited(_mirror('conversion', 'steam_link_success', p));
  }

  Future<void> logWishlistAdd({required String steamAppId}) async {
    final p = <String, Object>{'steam_app_id': steamAppId};
    await _safeLog('wishlist_add', p);
    unawaited(_mirror('click', 'wishlist_add', p));
  }

  Future<void> logWishlistDecisionClick({required String decision, required String steamAppId}) async {
    final p = <String, Object>{'decision': decision, 'steam_app_id': steamAppId};
    await _safeLog('wishlist_decision_click', p);
    unawaited(_mirror('click', 'wishlist_decision_click', p));
  }

  Future<void> logExploreFilterApply({required String summary}) async {
    final p = <String, Object>{'summary': summary};
    await _safeLog('explore_filter_apply', p);
    unawaited(_mirror('click', 'explore_filter_apply', p));
  }

  Future<void> logProfileShareClick() async {
    const p = <String, Object>{};
    await _safeLog('profile_share_click', p);
    unawaited(_mirror('click', 'profile_share_click', p));
  }

  Future<void> logPurchaseClick({required String productId, required String source}) async {
    final p = <String, Object>{'product_id': productId, 'source': source};
    await _safeLog('purchase_click', p);
    unawaited(_mirror('click', 'purchase_click', p));
  }

  /// 仅 Firebase；转化镜像在 [logPurchase]（含 transaction_id）已发送，避免重复记转化。
  Future<void> logPurchaseSuccess({required String productId, required String source}) async {
    await _safeLog('purchase_success', <String, Object>{'product_id': productId, 'source': source});
  }

  Future<void> logAffiliateClick({
    required String gameId,
    required String store,
    required double price,
    required bool isOfficial,
  }) async {
    final p = <String, Object>{
      'game_id': gameId,
      'store': store,
      'price': price,
      'is_official': isOfficial ? 1 : 0,
    };
    await _safeLog('affiliate_click', p);
    unawaited(_mirror('click', 'affiliate_click', p));
  }

  Future<void> logAdLoadFailed({
    required String adUnitId,
    required String adFormat,
    required String placement,
    required String errorCode,
  }) async {
    final p = <String, Object>{
      'ad_unit_id': adUnitId,
      'ad_format': adFormat,
      'placement': placement,
      'error_code': errorCode,
    };
    await _safeLog('ad_load_failed', p);
    unawaited(_mirror('exposure', 'ad_load_failed', p));
  }

  /// 个人中心主动评分：低分仅埋点并镜像后端；4–5 星另由 [ReviewService] 调起商店评价（此处 [submitToStore] 区分）。
  Future<void> logAppRatingStars({required int stars, required bool submitToStore}) async {
    final p = <String, Object>{
      'stars': stars,
      'submit_to_store': submitToStore ? 1 : 0,
    };
    await _safeLog('app_rating', p);
    unawaited(_mirror('click', 'app_rating', p));
  }

  Future<void> _safeLog(String name, Map<String, Object> params) async {
    try {
      await _analytics.logEvent(name: name, parameters: params);
    } catch (e, stack) {
      debugPrint('Analytics $name failed: $e\n$stack');
    }
  }
}
