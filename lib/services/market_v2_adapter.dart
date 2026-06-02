/// Maps `/api/v2/markets/:cc/*` payloads to legacy shapes used by UI layers.
class MarketV2Adapter {
  MarketV2Adapter._();

  static String steamHeaderImage(String appid) =>
      'https://cdn.cloudflare.steamstatic.com/steam/apps/$appid/header.jpg';

  static String _formatMoney(num? amount, String symbol) {
    if (amount == null) return '';
    if (amount == 0) return 'Free';
    final sym = symbol.trim().isEmpty ? '\$' : symbol;
    return '$sym${amount.toDouble().toStringAsFixed(2)}';
  }

  static double? _originalFromFinal(num? finalPrice, int discount) {
    if (finalPrice == null || finalPrice <= 0 || discount <= 0) return null;
    return finalPrice / (1 - discount / 100);
  }

  static Map<String, dynamic> marketRowToRecommendationItem(Map<String, dynamic> row) {
    final appid = row['appid']?.toString() ?? '';
    final sym = row['currencySymbol']?.toString() ?? '\$';
    final finalPrice = row['finalPrice'] is num
        ? (row['finalPrice'] as num).toDouble()
        : double.tryParse(row['finalPrice']?.toString() ?? '') ?? 0;
    final discount = row['discountPercent'] is num
        ? (row['discountPercent'] as num).round()
        : int.tryParse(row['discountPercent']?.toString() ?? '') ?? 0;
    final heat = row['heatScore'] is num
        ? (row['heatScore'] as num).toDouble()
        : double.tryParse(row['heatScore']?.toString() ?? '') ?? 0;
    final players = row['currentPlayers'] is num
        ? (row['currentPlayers'] as num).toDouble()
        : double.tryParse(row['currentPlayers']?.toString() ?? '') ?? 0;
    final original = _originalFromFinal(finalPrice, discount) ?? finalPrice;
    final fmtFinal = _formatMoney(finalPrice, sym);
    final fmtInit = discount > 0 ? _formatMoney(original, sym) : fmtFinal;

    return {
      'steamAppId': appid,
      'dealId': appid,
      'title': row['name']?.toString() ?? 'App $appid',
      'capsuleImage': steamHeaderImage(appid),
      'currentPrice': finalPrice,
      'originalPrice': original,
      'discountPercent': discount,
      'score': heat > 0 ? heat / 1000 : (discount * 10 + players / 10000),
      'reasons': <String>[],
      'tags': <String>['market_v2'],
      'steamFinalFormatted': fmtFinal,
      'steamInitialFormatted': fmtInit,
      'priceIsGlobalUsd': false,
      'priceSource': 'steam_store',
    };
  }

  static Map<String, dynamic> itemsPayloadFromMarketRows(
    List<dynamic> items, {
    required String countryCode,
    bool cacheHit = false,
  }) {
    final mapped = <Map<String, dynamic>>[];
    for (final e in items) {
      if (e is! Map) continue;
      mapped.add(marketRowToRecommendationItem(Map<String, dynamic>.from(e)));
    }
    return {
      'items': mapped,
      'meta': {
        'steamLinked': false,
        'effectiveCountry': countryCode,
        'effectiveLanguage': 'en',
        'countrySource': 'market_v2',
        'generatedAt': DateTime.now().toUtc().toIso8601String(),
        'cacheHit': cacheHit,
      },
    };
  }

  static Map<String, dynamic> gameResponseToRegionalDetail(Map<String, dynamic> v2) {
    final detail = v2['detail'] is Map
        ? Map<String, dynamic>.from(v2['detail'] as Map)
        : <String, dynamic>{};
    final prices = v2['prices'] is Map
        ? Map<String, dynamic>.from(v2['prices'] as Map)
        : <String, dynamic>{};
    final heat = v2['heat'] is Map
        ? Map<String, dynamic>.from(v2['heat'] as Map)
        : <String, dynamic>{};
    final index = v2['index'] is Map
        ? Map<String, dynamic>.from(v2['index'] as Map)
        : <String, dynamic>{};

    final cc = (v2['countryCode'] ?? index['countryCode'] ?? detail['countryCode'] ?? 'US')
        .toString()
        .toUpperCase();
    final sym = (prices['currencySymbol'] ?? index['currencySymbol'] ?? '\$').toString();
    final currency = (prices['currency'] ?? index['currency'] ?? 'USD').toString();

    final bucket = prices['bucket'] is Map
        ? Map<String, dynamic>.from(prices['bucket'] as Map)
        : <String, dynamic>{};

    final steamSnap = bucket['steam'] is Map
        ? Map<String, dynamic>.from(bucket['steam'] as Map)
        : null;

    final indexFinal = index['finalPrice'] is num
        ? (index['finalPrice'] as num).toDouble()
        : double.tryParse(index['finalPrice']?.toString() ?? '');
    final indexDisc = index['discountPercent'] is num
        ? (index['discountPercent'] as num).round()
        : int.tryParse(index['discountPercent']?.toString() ?? '') ?? 0;

    final steamFinal = steamSnap?['finalPrice'] is num
        ? (steamSnap!['finalPrice'] as num).toDouble()
        : indexFinal;
    final steamOrig = steamSnap?['originalPrice'] is num
        ? (steamSnap!['originalPrice'] as num).toDouble()
        : _originalFromFinal(steamFinal, indexDisc);
    final steamDisc = steamSnap?['discountPercent'] is num
        ? (steamSnap!['discountPercent'] as num).round()
        : indexDisc;

    final steamPrice = {
      'currency': steamSnap?['currency']?.toString() ?? currency,
      'initial': steamOrig ?? 0,
      'final': steamFinal ?? 0,
      'initialFormatted': _formatMoney(steamOrig, sym),
      'finalFormatted': _formatMoney(steamFinal, sym),
      'discountPercent': steamDisc,
      'fallbackUsed': false,
      'source': 'steam',
      if (detail['isFree'] == true) 'isFree': true,
    };

    final localDeals = <Map<String, dynamic>>[];
    const sources = [
      ['steam', 'steam'],
      ['isthereanydeal', 'isthereanydeal'],
      ['ggdeals', 'ggdeals'],
      ['cheapshark', 'cheapshark'],
    ];
    for (final pair in sources) {
      final key = pair[0];
      final source = pair[1];
      final snap = bucket[key];
      if (snap is! Map) continue;
      final m = Map<String, dynamic>.from(snap);
      final fp = m['finalPrice'] is num
          ? (m['finalPrice'] as num).toDouble()
          : double.tryParse(m['finalPrice']?.toString() ?? '');
      if (fp == null || fp <= 0) continue;
      final op = m['originalPrice'] is num
          ? (m['originalPrice'] as num).toDouble()
          : double.tryParse(m['originalPrice']?.toString() ?? '');
      final disc = m['discountPercent'] is num
          ? (m['discountPercent'] as num).round()
          : 0;
      localDeals.add({
        'source': source,
        'url': m['url']?.toString() ?? '',
        'finalPrice': fp,
        'originalPrice': op ?? fp,
        'discountPercent': disc,
        'currency': m['currency']?.toString() ?? currency,
        'countryCode': cc,
      });
    }

    final appid = (v2['appid'] ?? detail['appid'] ?? index['appid'] ?? '').toString();
    final players = heat['currentPlayers'] is num
        ? (heat['currentPlayers'] as num).toInt()
        : int.tryParse(heat['currentPlayers']?.toString() ?? '');

    return {
      'appid': appid,
      'country': {
        'countryCode': cc,
        'currency': currency,
        'currencySymbol': sym,
      },
      'steamStoreSnippet': {
        'shortDescription': detail['shortDescription']?.toString() ?? '',
        'headerImage': detail['headerImage']?.toString() ?? steamHeaderImage(appid),
        'name': detail['name']?.toString() ?? index['name']?.toString() ?? '',
      },
      'steamPrice': steamPrice,
      'localDeals': localDeals,
      'globalDeals': <Map<String, dynamic>>[],
      'warnings': {'showRegionWarning': false},
      'heat': {
        if (players != null) 'currentPlayers': players,
        'heatScore': heat['heatScore'],
      },
      'marketV2': true,
    };
  }

  /// explore tab → v2 list name
  static String listNameForExploreTab(String tab) {
    switch (tab) {
      case 'deep':
        return 'top-discounts';
      case 'hidden':
        return 'top-discounts';
      case 'for_you':
      case 'trending':
      default:
        return 'top-heat';
    }
  }
}
