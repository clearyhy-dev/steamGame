import 'package:flutter/material.dart';

import '../../../core/theme/colors.dart';
import '../../../l10n/app_localizations.dart';
import '../../../models/game_model.dart';
import '../../explore/widgets/game_card_small.dart';

/// 发现页（趋势）：高折扣 + 可联盟购买的横向推荐；卡片与 [GameCardSmall] 一致。
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

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            l10n.get('home_section_best_deals_to_buy'),
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary,
            ),
          ),
        ),
        Text(
          l10n.get('home_section_best_deals_to_buy_subtitle'),
          style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
        ),
        const SizedBox(height: 12),
        SizedBox(
          height: 200,
          child: ListView.builder(
            scrollDirection: Axis.horizontal,
            itemCount: games.length,
            itemBuilder: (_, i) => GameCardSmall(
              game: games[i],
              onTap: () => onOpenDetail(games[i]),
            ),
          ),
        ),
        const SizedBox(height: 24),
      ],
    );
  }
}
