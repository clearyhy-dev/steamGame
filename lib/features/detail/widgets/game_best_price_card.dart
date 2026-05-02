import 'package:flutter/material.dart';
import 'package:intl/intl.dart';

import '../../../core/theme/colors.dart';
import '../../../core/utils/deal_region_filter.dart';
import '../../../core/utils/price_formatter.dart';
import '../../../core/utils/price_region_resolver.dart';
import '../../../core/utils/steam_price_amount.dart';
import '../../../l10n/app_localizations.dart';
import '../../../models/game_model.dart';
import '../../../services/price_engine.dart';

/// 多店比价：本地区最低价（与 Price Region 一致）与全球最低价分开展示。
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
    this.regionalLocalDeals,
    this.regionalGlobalDeals,
  });

  final GameModel game;
  final PriceResult priceResult;

  final VoidCallback? onAddToWishlist;
  final List<Map<String, dynamic>>? dealLinks;

  /// When set with [regionalGlobalDeals], skips client-side region matching (backend-classified).
  final List<Map<String, dynamic>>? regionalLocalDeals;
  final List<Map<String, dynamic>>? regionalGlobalDeals;
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

  Future<void> _guardedTap(
    BuildContext context,
    AppLocalizations l10n,
    String source,
  ) async {
    if (onTapSource == null) return;
    if (!showRegionWarning) {
      await onTapSource!(source);
      return;
    }
    final ok = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.cardDark,
        title: Text(l10n.get('region_notice_title')),
        content: Text(
          '${l10n.get('prices_vary_by_region_detail')}\n\n${l10n.get('deal_activation_restrictions')}',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: Text(l10n.get('cancel_btn')),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            child: Text(l10n.get('continue_btn')),
          ),
        ],
      ),
    );
    if (ok == true) await onTapSource!(source);
  }

  Map<String, Map<String, dynamic>> _lowestPerSource(
    List<Map<String, dynamic>> links,
    Set<String> allowedSources,
  ) {
    final map = <String, Map<String, dynamic>>{};
    for (final row in links) {
      final source = (row['source'] ?? '').toString();
      if (!allowedSources.contains(source)) continue;
      final nextPrice = row['finalPrice'] is num
          ? (row['finalPrice'] as num).toDouble()
          : double.tryParse('${row['finalPrice']}');
      final cur = map[source];
      final curPrice = cur?['finalPrice'] is num
          ? (cur!['finalPrice'] as num).toDouble()
          : double.tryParse('${cur?['finalPrice']}');
      if (cur == null ||
          (nextPrice != null && (curPrice == null || nextPrice < curPrice))) {
        map[source] = row;
      }
    }
    return map;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final scheme = Theme.of(context).colorScheme;
    final region = PriceRegionResolver.resolveSync();
    final links = dealLinks ?? const <Map<String, dynamic>>[];
    const sources = {'steam', 'isthereanydeal', 'ggdeals', 'cheapshark'};
    late final List<Map<String, dynamic>> localList;
    late final List<Map<String, dynamic>> globalList;
    if (regionalLocalDeals != null && regionalGlobalDeals != null) {
      localList = List<Map<String, dynamic>>.from(regionalLocalDeals!);
      globalList = List<Map<String, dynamic>>.from(regionalGlobalDeals!);
    } else {
      final scoped =
          links.where((r) => sources.contains((r['source'] ?? '').toString()));
      localList =
          scoped.where((r) => dealMatchesPriceRegion(r, region)).toList();
      globalList =
          scoped.where((r) => !dealMatchesPriceRegion(r, region)).toList();
    }
    final localBySource = _lowestPerSource(localList, sources);
    final globalBySource = _lowestPerSource(globalList, sources);

    final hasLocal = localBySource.values.any((r) {
      final fp = r['finalPrice'];
      final v = fp is num ? fp.toDouble() : double.tryParse('$fp');
      return v != null && v > 0;
    });

    final otherSourceOrder =
        const ['isthereanydeal', 'ggdeals', 'cheapshark', 'steam'];

    Widget priceChip({
      required String source,
      required Map<String, dynamic>? row,
      required bool isGlobal,
    }) {
      final rawFinal = row?['finalPrice'];
      final curStr = (row?['currency'] ?? '').toString().trim();
      final currency = curStr.isNotEmpty
          ? curStr.toUpperCase()
          : (source == 'steam' ? 'USD' : 'USD');
      final rawFinalValue = rawFinal is num
          ? rawFinal.toDouble()
          : double.tryParse('${row?['finalPrice']}');
      final shownFinal = rawFinalValue == null
          ? null
          : normalizeDealPriceAmount(rawFinalValue, currency);
      final hasPrice = shownFinal != null && shownFinal > 0;
      final displayPrice = hasPrice
          ? formatRegionalPrice(amount: shownFinal, currency: currency)
          : (refreshingDeals
              ? l10n.get('affiliate_price_retrying')
              : l10n.get('no_regional_deal_short'));
      final globalTag = isGlobal
          ? '${l10n.get('global_price_tag')} · $currency'
          : '';

      return InkWell(
        onTap: onTapSource == null
            ? null
            : () => _guardedTap(context, l10n, source),
        borderRadius: BorderRadius.circular(10),
        child: Container(
          constraints: const BoxConstraints(minWidth: 104),
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
          decoration: BoxDecoration(
            color: AppColors.cardElevated,
            borderRadius: BorderRadius.circular(10),
            border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              Row(
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
                  Icon(
                    isPro ? Icons.lock_open : Icons.lock,
                    size: 12,
                    color: Colors.white54,
                  ),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                displayPrice,
                style: TextStyle(
                  color: hasPrice
                      ? AppColors.itadOrange
                      : Colors.white70,
                  fontSize: 13,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (globalTag.isNotEmpty)
                Text(
                  globalTag,
                  style: TextStyle(
                    fontSize: 10,
                    color: scheme.onSurfaceVariant.withValues(alpha: 0.85),
                  ),
                ),
            ],
          ),
        ),
      );
    }

    Widget rowTile({
      required String source,
      required Map<String, dynamic>? row,
      required bool isGlobal,
    }) {
      if (row == null) return const SizedBox.shrink();
      final rawFinal = row['finalPrice'];
      final curStr = (row['currency'] ?? '').toString().trim();
      final currency =
          curStr.isNotEmpty ? curStr.toUpperCase() : 'USD';
      final rawFinalValue = rawFinal is num
          ? rawFinal.toDouble()
          : double.tryParse('$rawFinal');
      final rawOriginal = row['originalPrice'];
      final rawOriginalValue = rawOriginal is num
          ? rawOriginal.toDouble()
          : double.tryParse('$rawOriginal');
      final shownFinal = rawFinalValue == null
          ? null
          : normalizeDealPriceAmount(rawFinalValue, currency);
      final shownOriginal = rawOriginalValue == null
          ? null
          : normalizeDealPriceAmount(rawOriginalValue, currency);

      return Padding(
        padding: const EdgeInsets.only(bottom: 10),
        child: InkWell(
          onTap:
              onTapSource == null ? null : () => _guardedTap(context, l10n, source),
          borderRadius: BorderRadius.circular(10),
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
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
                    if (isGlobal)
                      Padding(
                        padding: const EdgeInsets.only(top: 4),
                        child: Text(
                          '${l10n.get('global_price_tag')} · $currency',
                          style: TextStyle(
                            fontSize: 11,
                            color:
                                scheme.onSurfaceVariant.withValues(alpha: 0.8),
                          ),
                        ),
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
                      formatRegionalPrice(
                          amount: shownOriginal, currency: currency),
                      style: TextStyle(
                        fontSize: 12,
                        decoration: TextDecoration.lineThrough,
                        color: scheme.onSurfaceVariant.withValues(alpha: 0.7),
                      ),
                    ),
                  Text(
                    shownFinal == null
                        ? '—'
                        : formatRegionalPrice(
                            amount: shownFinal, currency: currency),
                    style: const TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
                      color: AppColors.itadOrange,
                    ),
                  ),
                  if ((row['discountPercent'] is num) &&
                      (row['discountPercent'] as num) > 0)
                    Container(
                      margin: const EdgeInsets.only(top: 4),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 8, vertical: 2),
                      decoration: BoxDecoration(
                        color: AppColors.discountRed.withValues(alpha: 0.2),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        '-${(row['discountPercent'] as num).toInt()}%',
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

    final official = priceResult.bestOfficial;
    final mockOfficialRegional = official != null &&
        official.price > 0 &&
        region.currency == 'USD';

    if (links.isEmpty && official == null) {
      return const SizedBox.shrink();
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
                Expanded(
                  child: Text(
                    l10n.get('price_section_local_best'),
                    style: TextStyle(
                      fontSize: 17,
                      fontWeight: FontWeight.bold,
                      color: scheme.onSurface,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (!hasLocal)
              Text(
                l10n
                    .get('no_local_deal_for_region')
                    .replaceAll('{region}', region.country),
                style: TextStyle(
                  fontSize: 13,
                  color: scheme.onSurfaceVariant.withValues(alpha: 0.9),
                ),
              )
            else ...[
              for (final src in const ['steam', 'isthereanydeal', 'ggdeals', 'cheapshark'])
                if (localBySource[src] != null)
                  rowTile(
                    source: src,
                    row: localBySource[src],
                    isGlobal: false,
                  ),
              if (mockOfficialRegional && localBySource['steam'] == null)
                rowTile(
                  source: 'steam',
                  row: {
                    'finalPrice': official.price,
                    'originalPrice': official.originalPrice,
                    'discountPercent': official.discountPercent,
                    'currency': 'USD',
                    'countryCode': 'US',
                  },
                  isGlobal: false,
                ),
            ],
            const SizedBox(height: 16),
            Row(
              children: [
                Icon(Icons.public,
                    size: 18, color: scheme.onSurfaceVariant.withValues(alpha: 0.9)),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    l10n.get('price_section_global_lowest'),
                    style: TextStyle(
                      fontSize: 14,
                      fontWeight: FontWeight.w600,
                      color: scheme.onSurfaceVariant.withValues(alpha: 0.95),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final src in otherSourceOrder)
                  if (globalBySource[src] != null)
                    priceChip(
                      source: src,
                      row: globalBySource[src],
                      isGlobal: true,
                    ),
              ],
            ),
            if (official != null &&
                official.price > 0 &&
                !mockOfficialRegional &&
                globalBySource['steam'] == null)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: rowTile(
                  source: 'steam',
                  row: {
                    'finalPrice': official.price,
                    'originalPrice': official.originalPrice,
                    'discountPercent': official.discountPercent,
                    'currency': 'USD',
                    'countryCode': 'US',
                  },
                  isGlobal: true,
                ),
              ),
            const SizedBox(height: 10),
            if (dealsUsingCache ||
                (dealsCacheUpdatedAt != null &&
                    !links.any((r) {
                      final fp = r['finalPrice'];
                      final v = fp is num
                          ? fp.toDouble()
                          : double.tryParse('$fp');
                      return v != null && v > 0;
                    })))
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
                    !links.any((r) {
                      final fp = r['finalPrice'];
                      final v = fp is num
                          ? fp.toDouble()
                          : double.tryParse('$fp');
                      return v != null && v > 0;
                    })))
              const SizedBox(height: 8),
            if (globalBySource.isNotEmpty || official != null) ...[
              Text(
                l10n.get('affiliate_third_party_note'),
                style: TextStyle(
                  fontSize: 11,
                  height: 1.3,
                  color: scheme.onSurfaceVariant.withValues(alpha: 0.75),
                ),
              ),
              const SizedBox(height: 8),
            ],
            if (showRegionWarning) ...[
              Text(
                l10n.get('region_restrictions_short'),
                style: TextStyle(
                  fontSize: 11,
                  height: 1.3,
                  color: scheme.onSurfaceVariant.withValues(alpha: 0.75),
                ),
              ),
              const SizedBox(height: 4),
              Text(
                '${l10n.get('app_country_subtitle')}: ${(selectedCountry ?? region.country).trim().toUpperCase()}',
                style: TextStyle(
                  fontSize: 11,
                  color: scheme.onSurfaceVariant.withValues(alpha: 0.72),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
