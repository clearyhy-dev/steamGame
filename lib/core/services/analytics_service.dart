import 'package:firebase_analytics/firebase_analytics.dart';
import 'package:flutter/foundation.dart';

/// Firebase Analytics 统一埋点入口。
class AnalyticsService {
  AnalyticsService._();
  static final AnalyticsService instance = AnalyticsService._();

  final FirebaseAnalytics _analytics = FirebaseAnalytics.instance;

  Future<void> logPaywallView({required String source}) async {
    await _safeLog(
      'view_paywall',
      <String, Object>{
        'source': source,
      },
    );
  }

  Future<void> logSubscriptionPlanSelect({
    required String productId,
    required String source,
  }) async {
    await _safeLog(
      'select_subscription_plan',
      <String, Object>{
        'product_id': productId,
        'source': source,
      },
    );
  }

  Future<void> logBeginCheckout({
    required String productId,
    required double value,
    required String currency,
    required String source,
  }) async {
    await _safeLog(
      'begin_checkout',
      <String, Object>{
        'product_id': productId,
        'value': value,
        'currency': currency,
        'source': source,
      },
    );
  }

  Future<void> logPurchase({
    required String productId,
    required double value,
    required String currency,
    String? transactionId,
    required String source,
  }) async {
    await _safeLog(
      'purchase',
      <String, Object>{
        'product_id': productId,
        'value': value,
        'currency': currency,
        'source': source,
        if (transactionId != null && transactionId.isNotEmpty) 'transaction_id': transactionId,
      },
    );
  }

  Future<void> logRestore({
    required bool success,
    required String source,
  }) async {
    await _safeLog(
      'restore_purchase',
      <String, Object>{
        'success': success ? 1 : 0,
        'source': source,
      },
    );
  }

  Future<void> logAdImpression({
    required String adUnitId,
    required String adFormat,
    required String placement,
  }) async {
    await _safeLog(
      'ad_impression',
      <String, Object>{
        'ad_unit_id': adUnitId,
        'ad_format': adFormat,
        'placement': placement,
      },
    );
  }

  Future<void> logAdClick({
    required String adUnitId,
    required String adFormat,
    required String placement,
  }) async {
    await _safeLog(
      'ad_click',
      <String, Object>{
        'ad_unit_id': adUnitId,
        'ad_format': adFormat,
        'placement': placement,
      },
    );
  }

  Future<void> logAdLoadFailed({
    required String adUnitId,
    required String adFormat,
    required String placement,
    required String errorCode,
  }) async {
    await _safeLog(
      'ad_load_failed',
      <String, Object>{
        'ad_unit_id': adUnitId,
        'ad_format': adFormat,
        'placement': placement,
        'error_code': errorCode,
      },
    );
  }

  Future<void> _safeLog(String name, Map<String, Object> params) async {
    try {
      await _analytics.logEvent(name: name, parameters: params);
    } catch (e, stack) {
      debugPrint('Analytics $name failed: $e\n$stack');
    }
  }
}
