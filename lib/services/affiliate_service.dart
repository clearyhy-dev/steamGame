import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart' as url_launcher;

import '../models/store_offer.dart';

/// 打开联盟链接；仅 Steam 官方在无联盟链接时回退 Steam 商店页。
class AffiliateService {
  AffiliateService._();
  static final AffiliateService instance = AffiliateService._();

  /// 成功打开返回 `true`；无可用链接、解析失败或无法调起外部浏览器时返回 `false`。
  Future<bool> tryOpenPurchase(StoreOffer offer, {required String fallbackSteamAppId}) async {
    var url = offer.affiliateUrl.trim();
    if (url.isEmpty) {
      if (offer.store != StoreIds.steam) {
        debugPrint('AffiliateService: no affiliate url for ${offer.store}');
        return false;
      }
      final id = fallbackSteamAppId.trim();
      if (id.isEmpty) {
        debugPrint('AffiliateService: no url and no steam id');
        return false;
      }
      url = 'https://store.steampowered.com/app/$id';
    }

    final uri = Uri.tryParse(url);
    if (uri == null) {
      debugPrint('AffiliateService: bad uri $url');
      return false;
    }
    try {
      if (await url_launcher.canLaunchUrl(uri)) {
        await url_launcher.launchUrl(uri, mode: url_launcher.LaunchMode.externalApplication);
        return true;
      }
      debugPrint('AffiliateService: cannot launch $uri');
      return false;
    } catch (e, st) {
      debugPrint('AffiliateService: $e\n$st');
      return false;
    }
  }

  Future<void> openAffiliate(StoreOffer offer, {required String fallbackSteamAppId}) async {
    await tryOpenPurchase(offer, fallbackSteamAppId: fallbackSteamAppId);
  }
}
