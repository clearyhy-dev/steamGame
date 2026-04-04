import 'package:flutter/material.dart';

import '../../../core/theme/colors.dart';
import '../../../l10n/app_localizations.dart';

/// 顶部欢迎区：标题、绑定状态、今日一句。
class HomeWelcomeHeader extends StatelessWidget {
  const HomeWelcomeHeader({
    super.key,
    required this.steamLinked,
    this.onTapProUpsell,
  });

  final bool steamLinked;

  /// 非 Pro 时点击「今日一句」跳转开通会员；为 null 则不响应点击。
  final VoidCallback? onTapProUpsell;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.fromLTRB(4, 8, 4, 4),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.get('companion_home_title'),
            style: const TextStyle(
              fontSize: 22,
              fontWeight: FontWeight.w700,
              color: AppColors.textPrimary,
              letterSpacing: -0.3,
            ),
          ),
          const SizedBox(height: 10),
          if (!steamLinked)
            Row(
              children: [
                Icon(
                  Icons.link_off_outlined,
                  size: 18,
                  color: AppColors.textSecondary,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    l10n.get('home_steam_not_linked'),
                    style: const TextStyle(
                      fontSize: 13,
                      color: AppColors.textSecondary,
                    ),
                  ),
                ),
              ],
            )
          else
            const SizedBox.shrink(),
          SizedBox(height: steamLinked ? 6 : 10),
          Material(
            color: Colors.transparent,
            child: InkWell(
              onTap: onTapProUpsell,
              borderRadius: BorderRadius.circular(14),
              child: Ink(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  borderRadius: BorderRadius.circular(14),
                  gradient: LinearGradient(
                    colors: [
                      AppColors.itadOrange.withOpacity(0.18),
                      AppColors.cardDark.withOpacity(0.9),
                    ],
                    begin: Alignment.topLeft,
                    end: Alignment.bottomRight,
                  ),
                  border: Border.all(color: Colors.white.withOpacity(0.06)),
                ),
                child: Row(
                  children: [
                    Expanded(
                      child: Text(
                        l10n.get('home_daily_tip'),
                        style: const TextStyle(
                          fontSize: 13,
                          height: 1.35,
                          color: AppColors.textSecondary,
                        ),
                      ),
                    ),
                    if (onTapProUpsell != null) ...[
                      const SizedBox(width: 8),
                      Icon(
                        Icons.chevron_right,
                        size: 20,
                        color: AppColors.textSecondary.withOpacity(0.85),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
