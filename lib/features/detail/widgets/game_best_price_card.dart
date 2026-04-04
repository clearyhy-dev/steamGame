import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/rewarded_affiliate_ad_service.dart';
import '../../../core/services/analytics_service.dart';
import '../../../core/theme/colors.dart';
import '../../../l10n/app_localizations.dart';
import '../../../models/game_model.dart';
import '../../../models/store_offer.dart';
import '../../../services/affiliate_service.dart';
import '../../../services/price_engine.dart';

/// 多店比价：官方低价 + 全渠道低价，主按钮跳转联盟/商店。
class GameBestPriceCard extends StatelessWidget {
  const GameBestPriceCard({
    super.key,
    required this.game,
    required this.priceResult,
    this.onAddToWishlist,
  });

  final GameModel game;
  final PriceResult priceResult;

  /// 购买失败时 SnackBar「加入愿望单」操作；由详情页注入（与心形按钮逻辑一致）。
  final VoidCallback? onAddToWishlist;

  static String _storeTitle(AppLocalizations l10n, String store) {
    switch (store) {
      case StoreIds.steam:
        return l10n.get('store_name_steam');
      case StoreIds.fanatical:
        return l10n.get('store_name_fanatical');
      case StoreIds.gmg:
        return l10n.get('store_name_gmg');
      case StoreIds.cdkeys:
        return l10n.get('store_name_cdkeys');
      default:
        return store;
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final currency = NumberFormat.simpleCurrency(locale: 'en_US');
    final official = priceResult.bestOfficial;
    final cheapest = priceResult.cheapest;
    if (official == null && cheapest == null) {
      return const SizedBox.shrink();
    }
    final sameOffer = official != null &&
        cheapest != null &&
        official.store == cheapest.store &&
        (official.price - cheapest.price).abs() < 0.0001;

    Future<void> onBuy() async {
      final target = cheapest ?? official;
      if (target == null) return;
      final gid = resolveOfferGameId(game);
      await AnalyticsService.instance.logAffiliateClick(
        gameId: gid,
        store: target.store,
        price: target.price,
        isOfficial: target.isOfficial,
      );
      final fallback = game.steamAppID.trim().isNotEmpty ? game.steamAppID.trim() : gid;

      Future<void> openAfterReward() async {
        final ok = await AffiliateService.instance.tryOpenPurchase(target, fallbackSteamAppId: fallback);
        if (ok || !context.mounted) return;

        final msg = target.store == StoreIds.cdkeys
            ? l10n.get('affiliate_cdkeys_sold_out')
            : l10n.get('affiliate_purchase_unavailable');
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(msg),
            action: onAddToWishlist != null
                ? SnackBarAction(
                    label: l10n.get('add_to_wishlist'),
                    onPressed: onAddToWishlist!,
                  )
                : null,
          ),
        );
      }

      void onAdBlocked(String key) {
        if (!context.mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.get(key))),
        );
      }

      await RewardedAffiliateAdService.instance.runPurchaseAfterRewardedAd(
        onRewardGranted: openAfterReward,
        onAdBlocked: onAdBlocked,
      );
    }

    Widget row(String label, StoreOffer? offer) {
      if (offer == null) {
        return const SizedBox.shrink();
      }
      return Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: TextStyle(
                      fontSize: 12,
                      fontWeight: FontWeight.w600,
                      color: scheme.onSurfaceVariant.withValues(alpha: 0.9),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    _storeTitle(l10n, offer.store),
                    style: TextStyle(
                      fontSize: 15,
                      fontWeight: FontWeight.w600,
                      color: scheme.onSurface,
                    ),
                  ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                if (offer.originalPrice > offer.price)
                  Text(
                    currency.format(offer.originalPrice),
                    style: TextStyle(
                      fontSize: 12,
                      decoration: TextDecoration.lineThrough,
                      color: scheme.onSurfaceVariant.withValues(alpha: 0.7),
                    ),
                  ),
                Text(
                  currency.format(offer.price),
                  style: const TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                    color: AppColors.itadOrange,
                  ),
                ),
                if (offer.discountPercent > 0)
                  Container(
                    margin: const EdgeInsets.only(top: 4),
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.discountRed.withValues(alpha: 0.2),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Text(
                      '-${offer.discountPercent}%',
                      style: const TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AppColors.discountRed,
                      ),
                    ),
                  ),
              ],
            ),
          ],
        ),
      );
    }

    return Card(
      elevation: 0,
      color: AppColors.cardDark,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(18),
        side: BorderSide(color: scheme.outlineVariant.withValues(alpha: 0.35)),
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(18, 16, 18, 16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                const Icon(Icons.local_fire_department_rounded, color: AppColors.itadOrange, size: 22),
                const SizedBox(width: 8),
                Text(
                  l10n.get('affiliate_section_best_price'),
                  style: TextStyle(
                    fontSize: 17,
                    fontWeight: FontWeight.bold,
                    color: scheme.onSurface,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 14),
            if (sameOffer) ...[
              row(l10n.get('affiliate_best_official'), official),
            ] else ...[
              row(l10n.get('affiliate_best_official'), official),
              row(l10n.get('affiliate_cheapest_deal'), cheapest),
            ],
            if (!sameOffer && cheapest != null && !cheapest.isOfficial) ...[
              Text(
                l10n.get('affiliate_third_party_note'),
                style: TextStyle(
                  fontSize: 11,
                  height: 1.3,
                  color: scheme.onSurfaceVariant.withValues(alpha: 0.75),
                ),
              ),
              const SizedBox(height: 12),
            ] else
              const SizedBox(height: 4),
            FilledButton(
              onPressed: (cheapest != null || official != null) ? onBuy : null,
              style: FilledButton.styleFrom(
                backgroundColor: AppColors.itadOrange,
                foregroundColor: const Color(0xFF1A1208),
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
              ),
              child: Text(
                l10n.get('affiliate_buy_best_price'),
                style: const TextStyle(fontWeight: FontWeight.w700, fontSize: 16),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
