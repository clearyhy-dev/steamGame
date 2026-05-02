import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/colors.dart';
import '../../../core/app_remote_config.dart';
import '../../../core/utils/price_formatter.dart';
import '../../../l10n/app_localizations.dart';
import '../../../models/game_model.dart';
import '../../../models/store_offer.dart';
import '../../../services/price_engine.dart';

/// 多店比价：官方低价 + 全渠道低价，主按钮跳转联盟/商店。
class GameBestPriceCard extends StatelessWidget {
  const GameBestPriceCard({
    super.key,
    required this.game,
    required this.priceResult,
    this.onAddToWishlist,
    this.dealLinks,
    this.onTapSource,
    this.isPro = false,
    this.refreshingDeals = false,
    this.dealsCacheUpdatedAt,
    this.dealsUsingCache = false,
    this.showRegionWarning = true,
    this.selectedCountry,
  });

  final GameModel game;
  final PriceResult priceResult;

  /// 购买失败时 SnackBar「加入愿望单」操作；由详情页注入（与心形按钮逻辑一致）。
  final VoidCallback? onAddToWishlist;
  final List<Map<String, dynamic>>? dealLinks;
  final Future<void> Function(String source)? onTapSource;
  final bool isPro;
  final bool refreshingDeals;
  final DateTime? dealsCacheUpdatedAt;
  final bool dealsUsingCache;
  final bool showRegionWarning;
  final String? selectedCountry;

  static const Map<String, String> _sourceName = {
    'steam': 'Steam',
    'isthereanydeal': 'ITAD',
    'ggdeals': 'GG.deals',
    'cheapshark': 'CheapShark',
  };

  static const Map<String, String> _sourceLogoAsset = {
    'steam': 'assets/platforms/steam.png',
    'isthereanydeal': 'assets/platforms/isthereanydeal.png',
    'ggdeals': 'assets/platforms/ggdeals.png',
    'cheapshark': 'assets/platforms/cheapshark.png',
  };

  Widget _sourceLogo(String source) {
    final assetPath = _sourceLogoAsset[source] ?? '';
    final textFallback = _sourceName[source] ?? source.toUpperCase();
    return ClipRRect(
      borderRadius: BorderRadius.circular(5),
      child: Container(
        width: 18,
        height: 18,
        color: AppColors.cardDark,
        alignment: Alignment.center,
        child: assetPath.isEmpty
            ? Text(
                textFallback.characters.take(1).toString(),
                style: const TextStyle(
                    fontSize: 10,
                    color: Colors.white,
                    fontWeight: FontWeight.w800),
              )
            : Image.asset(
                assetPath,
                width: 16,
                height: 16,
                fit: BoxFit.contain,
                filterQuality: FilterQuality.medium,
                errorBuilder: (_, __, ___) => Text(
                  textFallback.characters.take(1).toString(),
                  style: const TextStyle(
                      fontSize: 10,
                      color: Colors.white,
                      fontWeight: FontWeight.w800),
                ),
              ),
      ),
    );
  }

  String _currencyForCountry(String? countryCode) {
    final cc = (countryCode ?? '').trim().toUpperCase();
    return AppRemoteConfig.instance.regionSettings.countryCurrencyMap[cc] ?? 'USD';
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final official = priceResult.bestOfficial;
    if (official == null &&
        (dealLinks ?? const <Map<String, dynamic>>[]).isEmpty) {
      return const SizedBox.shrink();
    }
    final sourceOrder = const [
      'steam',
      'isthereanydeal',
      'ggdeals',
      'cheapshark'
    ];
    final otherSourceOrder = const ['isthereanydeal', 'ggdeals', 'cheapshark'];
    final links = (dealLinks ?? const <Map<String, dynamic>>[]);
    Map<String, Map<String, dynamic>> lowestBySource = {};
    for (final row in links) {
      final source = (row['source'] ?? '').toString();
      if (!sourceOrder.contains(source)) continue;
      final current = lowestBySource[source];
      final nextPrice = row['finalPrice'] is num
          ? (row['finalPrice'] as num).toDouble()
          : double.tryParse('${row['finalPrice']}');
      final curPrice = current?['finalPrice'] is num
          ? (current!['finalPrice'] as num).toDouble()
          : double.tryParse('${current?['finalPrice']}');
      if (current == null ||
          (nextPrice != null && (curPrice == null || nextPrice < curPrice))) {
        lowestBySource[source] = row;
      }
    }
    final steamRow = lowestBySource['steam'];
    Widget sourcePriceRow({
      required String label,
      required String source,
      required VoidCallback? onTap,
      required num? originalPrice,
      required num? finalPrice,
      required num? discountPercent,
      String? countryCode,
    }) {
      final currency = _currencyForCountry(countryCode);
      final parsedFinal = finalPrice?.toDouble();
      final parsedOriginal = originalPrice?.toDouble();
      final shownFinal = parsedFinal == null
          ? null
          : (parsedFinal > 1000 ? parsedFinal / 100.0 : parsedFinal);
      final shownOriginal = parsedOriginal == null
          ? null
          : (parsedOriginal > 1000 ? parsedOriginal / 100.0 : parsedOriginal);
      return Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (label.isNotEmpty) ...[
                      Text(
                        label,
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: scheme.onSurfaceVariant.withValues(alpha: 0.9),
                        ),
                      ),
                      const SizedBox(height: 4),
                    ],
                    Row(
                      children: [
                        Text(
                          _sourceName[source] ?? source,
                          style: TextStyle(
                            fontSize: 15,
                            fontWeight: FontWeight.w600,
                            color: scheme.onSurface,
                          ),
                        ),
                        if (source != 'steam') ...[
                          const SizedBox(width: 6),
                          Icon(
                            isPro ? Icons.lock_open : Icons.lock,
                            size: 12,
                            color: Colors.white54,
                          ),
                        ],
                      ],
                    ),
                  ],
                ),
              ),
              Column(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  if (source == 'steam')
                    Padding(
                      padding: const EdgeInsets.only(bottom: 4),
                      child: _sourceLogo('steam'),
                    ),
                  if (shownOriginal != null &&
                      shownFinal != null &&
                      shownOriginal > shownFinal)
                    Text(
                      formatRegionalPrice(amount: shownOriginal, currency: currency),
                      style: TextStyle(
                        fontSize: 12,
                        decoration: TextDecoration.lineThrough,
                        color: scheme.onSurfaceVariant.withValues(alpha: 0.7),
                      ),
                    ),
                  Text(
                    shownFinal == null ? '--' : formatRegionalPrice(amount: shownFinal, currency: currency),
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
                      color: AppColors.itadOrange,
                    ),
                  ),
                  if ((discountPercent ?? 0) > 0)
                    Container(
                      margin: const EdgeInsets.only(top: 4),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.discountRed.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        '-${discountPercent!.toInt()}%',
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
        ),
      );
    }

    Widget fallbackOfferRow(String label, StoreOffer? offer,
        {VoidCallback? onTap}) {
      if (offer == null) return const SizedBox.shrink();
      final fallbackCountry =
          (steamRow?['countryCode'] ?? '').toString().trim().toUpperCase();
      return sourcePriceRow(
        label: label,
        source: offer.store == StoreIds.steam ? 'steam' : offer.store,
        onTap: onTap,
        originalPrice: offer.originalPrice,
        finalPrice: offer.price,
        discountPercent: offer.discountPercent,
        countryCode: fallbackCountry.isEmpty ? null : fallbackCountry,
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
                const Icon(Icons.local_fire_department_rounded,
                    color: AppColors.itadOrange, size: 22),
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
            if (steamRow != null)
              sourcePriceRow(
                label: '',
                source: 'steam',
                onTap: onTapSource == null ? null : () => onTapSource!('steam'),
                originalPrice: steamRow['originalPrice'] is num
                    ? steamRow['originalPrice'] as num
                    : null,
                finalPrice: steamRow['finalPrice'] is num
                    ? steamRow['finalPrice'] as num
                    : null,
                discountPercent: steamRow['discountPercent'] is num
                    ? steamRow['discountPercent'] as num
                    : null,
                countryCode: (steamRow['countryCode'] ?? '').toString(),
              )
            else
              fallbackOfferRow(
                '',
                official,
                onTap: onTapSource == null ? null : () => onTapSource!('steam'),
              ),
            const SizedBox(height: 2),
            Text(
              l10n.get('affiliate_section_global_lowest'),
              style: TextStyle(
                fontSize: 12,
                fontWeight: FontWeight.w600,
                color: scheme.onSurfaceVariant.withValues(alpha: 0.9),
              ),
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: otherSourceOrder.map((source) {
                final row = lowestBySource[source];
                final rawFinal = row?['finalPrice'];
                final currency =
                    _currencyForCountry((row?['countryCode'] ?? '').toString());
                final rawFinalValue = rawFinal is num
                    ? rawFinal.toDouble()
                    : double.tryParse('${row?['finalPrice']}');
                final rawOriginal = row?['originalPrice'];
                final rawOriginalValue = rawOriginal is num
                    ? rawOriginal.toDouble()
                    : double.tryParse('${row?['originalPrice']}');
                final shownFinal = rawFinalValue == null
                    ? (rawOriginalValue == null
                        ? null
                        : (rawOriginalValue > 1000
                            ? rawOriginalValue / 100.0
                            : rawOriginalValue))
                    : (rawFinalValue > 1000
                        ? rawFinalValue / 100.0
                        : rawFinalValue);
                final hasPrice = shownFinal != null;
                final displayPrice = hasPrice
                    ? formatRegionalPrice(amount: shownFinal, currency: currency)
                    : (refreshingDeals
                        ? l10n.get('affiliate_price_retrying')
                        : '--');
                final selected = (selectedCountry ?? '').trim().toUpperCase();
                final rowCc = (row?['countryCode'] ?? '').toString().trim().toUpperCase();
                final regionMatched = selected.isEmpty || rowCc.isEmpty || selected == rowCc;
                final displayText = displayPrice;
                return InkWell(
                  onTap:
                      onTapSource == null ? null : () => onTapSource!(source),
                  borderRadius: BorderRadius.circular(10),
                  child: Container(
                    constraints: const BoxConstraints(minWidth: 104),
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    decoration: BoxDecoration(
                      color: AppColors.cardElevated,
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                          color: Colors.white.withValues(alpha: 0.08)),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        _sourceLogo(source),
                        const SizedBox(width: 6),
                        Text(
                          _sourceName[source] ?? source,
                          style: const TextStyle(
                            color: AppColors.textPrimary,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          regionMatched ? displayText : 'No regional deal available',
                          style: TextStyle(
                            color: regionMatched && hasPrice
                                ? AppColors.itadOrange
                                : Colors.white70,
                            fontSize: 11,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(width: 4),
                        Icon(
                          isPro ? Icons.lock_open : Icons.lock,
                          size: 12,
                          color: Colors.white54,
                        ),
                      ],
                    ),
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: 10),
            if (dealsUsingCache ||
                (dealsCacheUpdatedAt != null &&
                    !_hasAnyThirdPartyPrice(lowestBySource)))
              Text(
                dealsUsingCache
                    ? '${l10n.get('affiliate_cached_price')} · ${DateFormat('MM-dd HH:mm').format(dealsCacheUpdatedAt ?? DateTime.now())}'
                    : l10n.get('affiliate_price_retrying'),
                style: TextStyle(
                  fontSize: 11,
                  color: scheme.onSurfaceVariant.withValues(alpha: 0.75),
                ),
              ),
            if (dealsUsingCache ||
                (dealsCacheUpdatedAt != null &&
                    !_hasAnyThirdPartyPrice(lowestBySource)))
              const SizedBox(height: 8),
            if (otherSourceOrder.any((s) => lowestBySource[s] != null)) ...[
              if (showRegionWarning)
                Text(
                  'Region restrictions may apply.',
                  style: TextStyle(
                    fontSize: 11,
                    height: 1.3,
                    color: scheme.onSurfaceVariant.withValues(alpha: 0.75),
                  ),
                ),
              if (showRegionWarning) const SizedBox(height: 6),
              Text(
                l10n.get('affiliate_third_party_note'),
                style: TextStyle(
                  fontSize: 11,
                  height: 1.3,
                  color: scheme.onSurfaceVariant.withValues(alpha: 0.75),
                ),
              ),
              const SizedBox(height: 12),
            ] else ...[
              Text(
                l10n.get('affiliate_no_other_prices'),
                style: TextStyle(
                  fontSize: 11,
                  color: scheme.onSurfaceVariant.withValues(alpha: 0.75),
                ),
              ),
            ],
            if (showRegionWarning)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  'Price region: ${(selectedCountry ?? '').trim().isEmpty ? '--' : selectedCountry!.trim().toUpperCase()}',
                  style: TextStyle(
                    fontSize: 11,
                    color: scheme.onSurfaceVariant.withValues(alpha: 0.72),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }

  bool _hasAnyThirdPartyPrice(
      Map<String, Map<String, dynamic>> lowestBySource) {
    for (final source in const ['isthereanydeal', 'ggdeals', 'cheapshark']) {
      final row = lowestBySource[source];
      final rawFinal = row?['finalPrice'];
      final value = rawFinal is num
          ? rawFinal.toDouble()
          : double.tryParse('${row?['finalPrice']}');
      if (value != null && value > 0) return true;
    }
    return false;
  }
}
