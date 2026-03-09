import 'dart:async';

import 'package:in_app_purchase/in_app_purchase.dart';

import '../core/constants/app_constants.dart';

class PurchaseService {
  PurchaseService() {
    _subscription = InAppPurchase.instance.purchaseStream.listen(
      _onPurchaseUpdate,
      onDone: _onPurchaseDone,
      onError: _onPurchaseError,
    );
  }

  StreamSubscription<List<PurchaseDetails>>? _subscription;
  final List<void Function(PurchaseDetails)> _listeners = [];

  void addPurchaseListener(void Function(PurchaseDetails) listener) {
    _listeners.add(listener);
  }

  void removePurchaseListener(void Function(PurchaseDetails) listener) {
    _listeners.remove(listener);
  }

  void _onPurchaseUpdate(List<PurchaseDetails> purchases) {
    for (final purchase in purchases) {
      if (purchase.productID == AppConstants.productIdFullReport &&
          purchase.status == PurchaseStatus.purchased) {
        for (final fn in _listeners) {
          fn(purchase);
        }
      }
    }
  }

  void _onPurchaseDone() {
    _subscription?.cancel();
  }

  void _onPurchaseError(dynamic error) {}

  Future<bool> isAvailable() async {
    return InAppPurchase.instance.isAvailable();
  }

  Future<List<ProductDetails>> getProducts() async {
    const ids = <String>{AppConstants.productIdFullReport};
    final response = await InAppPurchase.instance.queryProductDetails(ids);
    if (response.notFoundIDs.isNotEmpty) return [];
    return response.productDetails;
  }

  Future<void> buyConsumable(ProductDetails product) async {
    final purchaseParam = PurchaseParam(productDetails: product);
    await InAppPurchase.instance.buyNonConsumable(purchaseParam: purchaseParam);
  }

  void dispose() {
    _subscription?.cancel();
    _listeners.clear();
  }
}
