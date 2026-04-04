import 'package:flutter/material.dart';

import '../../../core/theme/colors.dart';
import '../../../l10n/app_localizations.dart';
import '../../../models/game_model.dart';
import '../../../widgets/ad_banner.dart';
import '../../../widgets/section_header.dart';
import 'top_deal_banner.dart';
import 'top_list_item.dart';

/// 今日好价：Banner + Top 列表（非 Pro：广告插在 Top10 第 3、第 8 行；不足 3 条时在末尾补一条）。
class HomeBestDealsSection extends StatelessWidget {
  const HomeBestDealsSection({
    super.key,
    required this.topDeal,
    required this.top10,
    required this.isPro,
    required this.queryLimitReached,
    required this.onOpenDetail,
    required this.onTapUpgrade,
  });

  /// 在该条 [TopListItem] 之前插入广告（0-based 游戏下标）。第 3 行、第 8 行各一条。
  static const Set<int> _adBeforeGameIndex = {2, 6};

  final GameModel? topDeal;
  final List<GameModel> top10;
  final bool isPro;
  final bool queryLimitReached;
  final void Function(GameModel g) onOpenDetail;
  final VoidCallback onTapUpgrade;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SectionHeader(title: l10n.get('home_section_best_deals')),
        const SizedBox(height: 12),
        TopDealBanner(
          game: topDeal,
          onTap: topDeal != null ? () => onOpenDetail(topDeal!) : null,
        ),
        const SizedBox(height: 20),
        Text(
          l10n.get('top_10_deals_today'),
          style: const TextStyle(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: AppColors.textPrimary,
          ),
        ),
        const SizedBox(height: 12),
        if (top10.isEmpty)
          Padding(
            padding: const EdgeInsets.all(24),
            child: Center(
              child: Text(
                l10n.get('no_deals_pull'),
                style: const TextStyle(color: AppColors.textSecondary),
              ),
            ),
          )
        else
          ...() {
            final list = <Widget>[];
            for (var i = 0; i < top10.length; i++) {
              if (_adBeforeGameIndex.contains(i) && !isPro) {
                list.add(
                  const Padding(
                    padding: EdgeInsets.only(bottom: 12),
                    child: AdBanner(),
                  ),
                );
              }
              list.add(
                TopListItem(
                  game: top10[i],
                  rank: i + 1,
                  onTap: () => onOpenDetail(top10[i]),
                ),
              );
            }
            // 不足 3 条好价时无法在「第 3 行」插广告，在列表末尾补一条
            if (top10.length <= 2 && !isPro) {
              list.add(
                const Padding(
                  padding: EdgeInsets.only(top: 4, bottom: 12),
                  child: AdBanner(),
                ),
              );
            }
            return list;
          }(),
        if (queryLimitReached)
          Padding(
            padding: const EdgeInsets.only(top: 8, bottom: 8),
            child: InkWell(
              onTap: onTapUpgrade,
              borderRadius: BorderRadius.circular(12),
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 16),
                child: Row(
                  children: [
                    Icon(Icons.workspace_premium_outlined, color: AppColors.itadOrange, size: 24),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(
                        l10n.get('lookups_used_tap_unlock'),
                        style: const TextStyle(fontSize: 13, color: AppColors.textSecondary),
                      ),
                    ),
                    const Icon(Icons.chevron_right, color: AppColors.textSecondary),
                  ],
                ),
              ),
            ),
          ),
      ],
    );
  }
}
