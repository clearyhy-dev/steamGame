import 'package:flutter/material.dart';

import '../features/subscription/subscription_page.dart';
import '../l10n/app_localizations.dart';
import 'rewarded_affiliate_ad_service.dart';
import 'storage_service.dart';
import 'theme/colors.dart';

/// ITAD / GG.deals 价格：Pro 永久可见；非会员每次查看须观看激励广告（不持久解锁）。
class ThirdPartyPriceAccess {
  ThirdPartyPriceAccess._();
  static final ThirdPartyPriceAccess instance = ThirdPartyPriceAccess._();

  Future<bool> isProMember() async {
    final storage = StorageService.instance;
    if (!storage.isInitialized) await storage.init();
    return storage.isPro();
  }

  /// 非会员观看一次激励广告后返回 true（仅当前页面/session，不写本地缓存）。
  Future<bool> promptUnlock(
    BuildContext context, {
    required String paywallSource,
  }) async {
    if (await isProMember()) return true;
    if (!context.mounted) return false;

    final l10n = AppLocalizations.of(context);
    final choice = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.cardDark,
        title: Text(l10n.get('affiliate_unlock_dialog_title')),
        content: Text(l10n.get('affiliate_unlock_dialog_body')),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text(l10n.get('cancel_btn')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, 'pro'),
            child: Text(l10n.get('affiliate_go_pro_unlock')),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(ctx, 'ad'),
            style: FilledButton.styleFrom(backgroundColor: AppColors.itadOrange),
            child: Text(l10n.get('affiliate_watch_ad_unlock')),
          ),
        ],
      ),
    );

    if (!context.mounted) return false;
    if (choice == 'pro') {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => SubscriptionPage(paywallSource: paywallSource),
        ),
      );
      return isProMember();
    }
    if (choice != 'ad') return false;

    var rewarded = false;
    await RewardedAffiliateAdService.instance.runWithRewardedAd(
      placement: 'third_party_prices',
      onRewardGranted: () async {
        rewarded = true;
      },
      onAdBlocked: (key) {
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.get(key))),
        );
      },
    );
    return rewarded;
  }
}
