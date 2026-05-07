import 'storage_service.dart';

/// 统一 Free / Pro 权限：功能处调用后未通过则跳转订阅页
class AccessControl {
  static final AccessControl _instance = AccessControl._internal();
  factory AccessControl() => _instance;
  AccessControl._internal();

  final StorageService _storage = StorageService.instance;

  Future<bool> canUseUnlimitedSearch() async => await _storage.isPro();

  Future<bool> canUseWishlistNotification() async => await _storage.isPro();

  Future<bool> canRemoveAds() async => await _storage.isPro();

  /// 今日免费次数是否已用尽（未用尽返回 true）
  Future<bool> canSearchToday() async {
    // Product update: remove daily query cap for all users.
    return true;
  }
}
