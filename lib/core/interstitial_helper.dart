import 'interstitial_ad_service.dart';

/// 插屏触发入口（具体加载/展示/重试见 [InterstitialAdService]）。
/// 不在 Explore 打开时调用；由详情浏览次数等行为触发。
class InterstitialHelper {
  /// 每累计查看 5 个详情页且当日未满额度时尝试展示插屏（非 Pro）。
  static Future<void> tryShowAfterDetailView() =>
      InterstitialAdService.instance.maybeShowAfterDetailView();

  /// 加入愿望单后可选调用（若产品需要）。
  static Future<void> tryShowAfterAddToWishlist() =>
      InterstitialAdService.instance.maybeShowAfterWishlistAdd();
}
