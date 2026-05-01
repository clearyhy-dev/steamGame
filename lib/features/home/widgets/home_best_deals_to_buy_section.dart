import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../../core/theme/colors.dart';
import '../../../core/utils/country_price.dart';
import '../../../l10n/app_localizations.dart';
import '../../../models/game_model.dart';
import '../../../models/store_offer.dart';
import '../../../services/price_engine.dart';
import '../../../widgets/section_header.dart';

/// 发现页（趋势）：高折扣 + 可联盟购买的横向推荐。
class HomeBestDealsToBuySection extends StatelessWidget {
  const HomeBestDealsToBuySection({
    super.key,
    required this.games,
    required this.onOpenDetail,
  });

  final List<GameModel> games;
  final void Function(GameModel g) onOpenDetail;

  @override
  Widget build(BuildContext context) {
    if (games.isEmpty) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final engine = PriceEngineService();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(title: l10n.get('home_section_best_deals_to_buy')),
        const SizedBox(height: 4),
        Text(
          l10n.get('home_section_best_deals_to_buy_subtitle'),
          style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 168,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            itemCount: games.length,
            separatorBuilder: (_, __) => const SizedBox(width: 12),
            itemBuilder: (context, i) {
              final g = games[i];
              final result = engine.calculateBestPrice(buildMockStoreOffers(g));
              final tag = result.cheapest?.store ?? result.bestOfficial?.store ?? '';
              return _BuyCard(
                game: g,
                storeTag: tag,
                onTap: () => onOpenDetail(g),
                borderColor: scheme.outlineVariant.withValues(alpha: 0.35),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _BuyCard extends StatelessWidget {
  const _BuyCard({
    required this.game,
    required this.storeTag,
    required this.onTap,
    required this.borderColor,
  });

  final GameModel game;
  final String storeTag;
  final VoidCallback onTap;
  final Color borderColor;

  @override
  Widget build(BuildContext context) {
    final currency = CountryPrice.formatter();
    final img = game.image.isNotEmpty ? game.image : '';
    return Material(
      color: AppColors.cardDark,
      borderRadius: BorderRadius.circular(16),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(16),
        child: Container(
          width: 132,
          padding: const EdgeInsets.all(10),
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(16),
            border: Border.all(color: borderColor),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              ClipRRect(
                borderRadius: BorderRadius.circular(10),
                child: img.isEmpty
                    ? const SizedBox(
                        height: 72,
                        width: double.infinity,
                        child: ColoredBox(color: AppColors.cardElevated),
                      )
                    : CachedNetworkImage(
                        imageUrl: img,
                        height: 72,
                        width: double.infinity,
                        fit: BoxFit.cover,
                        placeholder: (_, __) => const SizedBox(
                          height: 72,
                          child: ColoredBox(color: AppColors.cardElevated),
                        ),
                        errorWidget: (_, __, ___) => const SizedBox(
                          height: 72,
                          child: ColoredBox(color: AppColors.cardElevated),
                        ),
                      ),
              ),
              const SizedBox(height: 8),
              Text(
                game.name,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                  fontSize: 12,
                  fontWeight: FontWeight.w600,
                  color: AppColors.textPrimary,
                  height: 1.2,
                ),
              ),
              const Spacer(),
              if (game.discount > 0)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                  decoration: BoxDecoration(
                    color: AppColors.discountRed.withValues(alpha: 0.22),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(
                    '-${game.discount}%',
                    style: const TextStyle(
                      fontSize: 11,
                      fontWeight: FontWeight.w700,
                      color: AppColors.discountRed,
                    ),
                  ),
                ),
              if (storeTag.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    storeTag.toUpperCase(),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: TextStyle(
                      fontSize: 10,
                      fontWeight: FontWeight.w500,
                      color: AppColors.textSecondary.withValues(alpha: 0.9),
                    ),
                  ),
                ),
              const SizedBox(height: 4),
              if (game.originalPrice > 0)
                Text(
                  currency.format(game.originalPrice),
                  style: const TextStyle(
                    fontSize: 10,
                    color: AppColors.textSecondary,
                    decoration: TextDecoration.lineThrough,
                  ),
                ),
              Text(
                currency.format(game.price),
                style: const TextStyle(
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                  color: AppColors.itadOrange,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
