import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart' as url_launcher;

import '../models/store_offer.dart';

/// 打开联盟链接；无链接时回退 Steam 商店页。
class AffiliateService {
  AffiliateService._();
  static final AffiliateService instance = AffiliateService._();

  Future<void> openAffiliate(StoreOffer offer, {required String fallbackSteamAppId}) async {
    var url = offer.affiliateUrl.trim();
    if (url.isEmpty) {
      final id = fallbackSteamAppId.trim();
      if (id.isEmpty) {
        debugPrint('AffiliateService: no url and no steam id');
        return;
      }
      url = 'https://store.steampowered.com/app/$id';
    }

    final uri = Uri.tryParse(url);
    if (uri == null) {
      debugPrint('AffiliateService: bad uri $url');
      return;
    }
    try {
      if (await url_launcher.canLaunchUrl(uri)) {
        await url_launcher.launchUrl(uri, mode: url_launcher.LaunchMode.externalApplication);
      } else {
        debugPrint('AffiliateService: cannot launch $uri');
      }
    } catch (e, st) {
      debugPrint('AffiliateService: $e\n$st');
    }
  }
}
