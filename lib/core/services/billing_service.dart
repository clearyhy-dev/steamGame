import 'dart:async';
import 'package:in_app_purchase/in_app_purchase.dart';
import '../storage_service.dart';
import 'analytics_service.dart';

/// Google Play Billing 订阅服务（v6+，订阅模式）
class BillingService {
  static final BillingService _instance = BillingService._internal();
  factory BillingService() => _instance;
  BillingService._internal();

  final InAppPurchase _iap = InAppPurchase.instance;
  StreamSubscription<List<PurchaseDetails>>? _subscription;

  /// Google Play Console 配置：7 天 $0.99 / 月 $2.99 / 年 $16.99
  static const String trialWeekId = 'pro_week_099';
  static const String monthlyId = 'pro_month_299';
  static const String yearlyId = 'pro_year_1699';
  static const Set<String> _productIds = {trialWeekId, monthlyId, yearlyId};

  bool _initialized = false;
  bool get isInitialized => _initialized;

  static const Map<String, double> _priceUsdByProductId = {
    trialWeekId: 0.99,
    monthlyId: 2.99,
    yearlyId: 16.99,
  };

  Future<void> init() async {
    if (_initialized) return;
    final bool available = await _iap.isAvailable();
    if (!available) return;
    _subscription = _iap.purchaseStream.listen(_listenToPurchase);
    _initialized = true;
  }

  Future<List<ProductDetails>> loadProducts() async {
    if (!_initialized) await init();
    final response = await _iap.queryProductDetails(_productIds);
    if (response.notFoundIDs.isNotEmpty) return [];
    return response.productDetails;
  }

  Future<void> buy(ProductDetails product) async {
    await _logBeginCheckout(product.id);
    final param = PurchaseParam(productDetails: product);
    await _iap.buyNonConsumable(purchaseParam: param);
  }

  /// 订阅类产品需用 buyConsumable 或服务端验证；若 Play 配置为订阅，可用 buyNonConsumable
  Future<void> buySubscription(ProductDetails product) async {
    await _logBeginCheckout(product.id);
    final param = PurchaseParam(productDetails: product);
    await _iap.buyNonConsumable(purchaseParam: param);
  }

  void _listenToPurchase(List<PurchaseDetails> purchases) {
    for (final purchase in purchases) {
      if (purchase.status == PurchaseStatus.purchased) {
        StorageService.instance.setPro(true);
        _logPurchaseSuccess(purchase, 'purchase_stream');
      } else if (purchase.status == PurchaseStatus.restored) {
        StorageService.instance.setPro(true);
        AnalyticsService.instance.logRestore(
          success: true,
          source: 'purchase_stream',
        );
      } else if (purchase.status == PurchaseStatus.error) {
        AnalyticsService.instance.logRestore(
          success: false,
          source: 'purchase_error',
        );
      }
      if (purchase.pendingCompletePurchase) {
        _iap.completePurchase(purchase);
      }
    }
  }

  Future<void> restore() async {
    try {
      await _iap.restorePurchases();
      await AnalyticsService.instance.logRestore(
        success: true,
        source: 'restore_button',
      );
    } catch (_) {
      await AnalyticsService.instance.logRestore(
        success: false,
        source: 'restore_button',
      );
      rethrow;
    }
    // 若 restore 后 purchaseStream 会推送历史购买，这里不重复设 isPro；若不会推送，可再查一次
    // 依赖 purchaseStream 推送即可
  }

  Future<void> _logBeginCheckout(String productId) async {
    final value = _priceUsdByProductId[productId] ?? 0.0;
    await AnalyticsService.instance.logBeginCheckout(
      productId: productId,
      value: value,
      currency: 'USD',
      source: 'subscription_page',
    );
  }

  Future<void> _logPurchaseSuccess(PurchaseDetails purchase, String source) async {
    final productId = purchase.productID;
    final value = _priceUsdByProductId[productId] ?? 0.0;
    await AnalyticsService.instance.logPurchase(
      productId: productId,
      value: value,
      currency: 'USD',
      transactionId: purchase.purchaseID,
      source: source,
    );
    await AnalyticsService.instance.logPurchaseSuccess(
      productId: productId,
      source: source,
    );
  }

  void dispose() {
    _subscription?.cancel();
    _subscription = null;
    _initialized = false;
  }
}
