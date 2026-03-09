class AppConstants {
  AppConstants._();

  static const String appName = 'MatchMuse';

  /// 测试用：设为 true 时 App 内所有会员功能视为已解锁。发版前请改回 false。
  static const bool kUnlockProForTesting = true;

  /// 免费用户：仅 1 张
  static const int minPhotosFree = 1;
  static const int maxPhotosFree = 1;
  /// Pro 用户：3–5 张
  static const int minPhotos = 3;
  static const int maxPhotos = 5;

  /// 高利润版：Pro 一次性解锁
  static const String productIdFullReport = 'matchmuse_pro';
  static const String priceDisplay = '\$19.99';

  static const int maxImageBytes = 800 * 1024; // 800KB after compress
  static const int compressQuality = 85;
}
