import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../../core/theme/colors.dart';
import '../../../l10n/app_localizations.dart';
import '../../../models/game_model.dart';
import '../../../widgets/section_header.dart';
import '../../recommendation/wishlist_reason_localizations.dart';

class HomeWishlistDecisionsSection extends StatelessWidget {
  const HomeWishlistDecisionsSection({
    super.key,
    required this.items,
    required this.backendAuthed,
    required this.loading,
    this.onOpenDetail,
    this.onSeeAll,
  });

  final List<Map<String, dynamic>> items;
  /// 已登录后端（有 JWT）；愿望单决策来自账号收藏，不要求必须绑定 Steam。
  final bool backendAuthed;
  final bool loading;
  final void Function(GameModel game)? onOpenDetail;
  final VoidCallback? onSeeAll;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Expanded(child: SectionHeader(title: l10n.get('home_section_wishlist_decisions'))),
            if (onSeeAll != null && items.isNotEmpty)
              TextButton(
                onPressed: onSeeAll,
                child: Text(l10n.get('home_wishlist_see_all')),
              ),
          ],
        ),
        const SizedBox(height: 10),
        if (loading)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 16),
            child: Center(child: SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2))),
          )
        else if (!backendAuthed)
          _hint(context, l10n.get('home_wishlist_sign_in_hint'))
        else if (items.isEmpty)
          _hint(context, l10n.get('home_wishlist_empty_hint'))
        else
          SizedBox(
            height: 168,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: items.length,
              separatorBuilder: (_, __) => const SizedBox(width: 12),
              itemBuilder: (_, i) {
                final m = items[i];
                final appid = m['appid']?.toString() ?? '';
                final title = m['name']?.toString() ?? '';
                final img = m['headerImage']?.toString() ?? '';
                final dec = m['decision']?.toString() ?? '';
                final reasons = (m['reasonCodes'] as List<dynamic>?) ?? [];
                final rc = reasons.isNotEmpty ? reasons.first.toString() : '';
                final reasonText = localizedWishlistReason(l10n, rc);
                final sale = m['currentPrice'];
                final off = m['discountPercent'];
                final disc = off is num ? off.toInt() : int.tryParse(off?.toString() ?? '0') ?? 0;
                final price = sale is num ? sale.toDouble() : double.tryParse(sale?.toString() ?? '0') ?? 0.0;
                return GestureDetector(
                  onTap: () {
                    if (onOpenDetail == null || appid.isEmpty) return;
                    final dealId = m['dealId']?.toString() ?? '';
                    final retail = m['originalPrice'];
                    final retailD = retail is num ? retail.toDouble() : double.tryParse(retail?.toString() ?? '') ?? 0.0;
                    final g = GameModel(
                      dealID: dealId,
                      appId: dealId.isNotEmpty ? dealId : appid,
                      name: title,
                      image: img,
                      price: price,
                      originalPrice: retailD > 0 ? retailD : price,
                      discount: disc,
                      steamAppID: appid,
                      images: img.isNotEmpty ? [img] : [],
                    );
                    onOpenDetail!(g);
                  },
                  child: Container(
                    width: 148,
                    decoration: BoxDecoration(
                      borderRadius: BorderRadius.circular(14),
                      color: AppColors.cardDark.withOpacity(0.9),
                      border: Border.all(color: Colors.white.withOpacity(0.06)),
                    ),
                    clipBehavior: Clip.antiAlias,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Expanded(
                          child: img.isEmpty
                              ? Container(color: Colors.black26)
                              : CachedNetworkImage(imageUrl: img, fit: BoxFit.cover),
                        ),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(8, 6, 8, 4),
                          child: Text(
                            title,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: AppColors.textPrimary),
                          ),
                        ),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(8, 0, 8, 6),
                          child: Text(
                            _decisionLabel(l10n, dec),
                            style: TextStyle(fontSize: 10, fontWeight: FontWeight.w600, color: _decisionColor(dec)),
                          ),
                        ),
                        if (reasonText.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                            child: Text(
                              reasonText,
                              maxLines: 2,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(fontSize: 9, color: AppColors.textSecondary, height: 1.2),
                            ),
                          ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
      ],
    );
  }

  Widget _hint(BuildContext context, String text) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: AppColors.cardDark.withOpacity(0.6),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white.withOpacity(0.05)),
      ),
      child: Text(text, style: const TextStyle(fontSize: 13, color: AppColors.textSecondary, height: 1.35)),
    );
  }

  String _decisionLabel(AppLocalizations l10n, String code) {
    switch (code) {
      case 'buy_now':
        return l10n.get('decision_buy_now');
      case 'wait':
        return l10n.get('decision_wait');
      case 'watch':
        return l10n.get('decision_watch');
      case 'skip_for_now':
        return l10n.get('decision_skip_for_now');
      default:
        return code;
    }
  }

  Color _decisionColor(String code) {
    switch (code) {
      case 'buy_now':
        return Colors.greenAccent.shade400;
      case 'wait':
        return AppColors.textSecondary;
      case 'watch':
        return AppColors.itadOrange;
      case 'skip_for_now':
        return Colors.blueGrey;
      default:
        return AppColors.textSecondary;
    }
  }
}
