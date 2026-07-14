import '../core/utils/price_formatter.dart';
import '../core/utils/steam_price_amount.dart';

/// Maps `/api/v2/markets/:cc/*` payloads to legacy shapes used by UI layers.
class MarketV2Adapter {
  MarketV2Adapter._();

  static String steamHeaderImage(String appid) =>
      'https://cdn.cloudflare.steamstatic.com/steam/apps/$appid/header.jpg';

  static double? _originalFromFinal(num? finalPrice, int discount) {
    if (finalPrice == null || finalPrice <= 0 || discount <= 0) return null;
    return finalPrice / (1 - discount / 100);
  }

  static Map<String, dynamic> marketRowToRecommendationItem(Map<String, dynamic> row) {
    final appid = row['appid']?.toString() ?? '';
    final currency =
        (row['currency'] ?? 'USD').toString().trim().toUpperCase();
    final finalPriceRaw = row['finalPrice'] is num
        ? (row['finalPrice'] as num).toDouble()
        : double.tryParse(row['finalPrice']?.toString() ?? '') ?? 0;
    final finalPrice =
        normalizeDealPriceAmount(finalPriceRaw, currency) ?? finalPriceRaw;
    final discount = row['discountPercent'] is num
        ? (row['discountPercent'] as num).round()
        : int.tryParse(row['discountPercent']?.toString() ?? '') ?? 0;
    final heat = row['heatScore'] is num
        ? (row['heatScore'] as num).toDouble()
        : double.tryParse(row['heatScore']?.toString() ?? '') ?? 0;
    final players = row['currentPlayers'] is num
        ? (row['currentPlayers'] as num).toDouble()
        : double.tryParse(row['currentPlayers']?.toString() ?? '') ?? 0;
    final original =
        _originalFromFinal(finalPrice, discount) ?? finalPrice;
    final fmtFinal = formatRegionalPrice(amount: finalPrice, currency: currency);
    final fmtInit =
        discount > 0 ? formatRegionalPrice(amount: original, currency: currency) : fmtFinal;

    var rawTitle = row['name']?.toString() ?? '';
    if (RegExp(r'^App \d+$').hasMatch(rawTitle.trim())) {
      rawTitle = appid.isNotEmpty ? 'Game #$appid' : rawTitle;
    }
    return {
      'steamAppId': appid,
      'dealId': appid,
      'title': rawTitle.isNotEmpty ? rawTitle : 'App $appid',
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

  static double? _cellPrice(num? raw, String currency, {required bool isSteam}) {
    if (raw == null) return null;
    return isSteam
        ? steamMinorUnitsToDisplayAmount(raw, currency)
        : normalizeDealPriceAmount(raw, currency);
  }

  static Map<String, dynamic>? _dealFromPlatformCell({
    required String source,
    required Map<String, dynamic> cell,
    required String cc,
    required String currency,
    bool steamMinorUnits = false,
  }) {
    final isSteam = source == 'steam' && steamMinorUnits;
    final fpRaw = cell['finalPrice'] is num
        ? cell['finalPrice'] as num
        : num.tryParse('${cell['finalPrice']}');
    final opRaw = cell['originalPrice'] is num
        ? cell['originalPrice'] as num
        : num.tryParse('${cell['originalPrice']}');
    final fp = _cellPrice(fpRaw, currency, isSteam: isSteam);
    final op = _cellPrice(opRaw, currency, isSteam: isSteam);
    final disc = cell['discountPercent'] is num
        ? (cell['discountPercent'] as num).round()
        : int.tryParse('${cell['discountPercent']}') ?? 0;
    final url = cell['url']?.toString() ?? '';
    final hasPrice = fp != null && fp > 0;
    final hasDiscount = disc > 0;
    if (!hasPrice && !hasDiscount && url.isEmpty) return null;
    return {
      'source': source,
      'url': url,
      'finalPrice': hasPrice ? fp : null,
      'originalPrice': op ?? fp,
      'discountPercent': disc,
      'currency': cell['currency']?.toString() ?? currency,
      'countryCode': cc,
    };
  }

  static void _appendDealIfMissing(
    List<Map<String, dynamic>> out,
    Map<String, dynamic>? deal,
  ) {
    if (deal == null) return;
    final source = deal['source']?.toString() ?? '';
    if (source.isEmpty) return;
    if (out.any((d) => d['source']?.toString() == source)) return;
    out.add(deal);
  }

  static List<Map<String, dynamic>> _dealsFromPriceSummary(
    Map<String, dynamic>? summary,
    String cc,
    String currency,
  ) {
    if (summary == null) return [];
    final platforms = summary['platforms'];
    if (platforms is! Map) return [];
    final p = Map<String, dynamic>.from(platforms);
    final out = <Map<String, dynamic>>[];
    for (final pair in const [
      ['steam', 'steam'],
      ['isthereanydeal', 'isthereanydeal'],
      ['ggdeals', 'ggdeals'],
    ]) {
      final cellRaw = p[pair[0]];
      if (cellRaw is! Map) continue;
      _appendDealIfMissing(
        out,
        _dealFromPlatformCell(
          source: pair[1],
          cell: Map<String, dynamic>.from(cellRaw),
          cc: cc,
          currency: currency,
          steamMinorUnits: false,
        ),
      );
    }
    return out;
  }

  static void _putDeal(Map<String, Map<String, dynamic>> out, Map<String, dynamic>? deal) {
    if (deal == null) return;
    final source = deal['source']?.toString() ?? '';
    if (source.isEmpty) return;
    final cur = out[source];
    if (cur == null) {
      out[source] = deal;
      return;
    }
    final nextP = deal['finalPrice'] is num
        ? (deal['finalPrice'] as num).toDouble()
        : double.tryParse('${deal['finalPrice']}');
    final curP = cur['finalPrice'] is num
        ? (cur['finalPrice'] as num).toDouble()
        : double.tryParse('${cur['finalPrice']}');
    final nextDisc = deal['discountPercent'] is num
        ? (deal['discountPercent'] as num).round()
        : int.tryParse('${deal['discountPercent']}') ?? 0;
    final curDisc = cur['discountPercent'] is num
        ? (cur['discountPercent'] as num).round()
        : int.tryParse('${cur['discountPercent']}') ?? 0;
    if (nextP != null && nextP > 0 && (curP == null || nextP < curP || nextDisc > curDisc)) {
      out[source] = deal;
    }
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

    final indexSummary = index['priceSummary'] is Map
        ? Map<String, dynamic>.from(index['priceSummary'] as Map)
        : null;
    final summaryPlatforms = indexSummary?['platforms'] is Map
        ? Map<String, dynamic>.from(indexSummary!['platforms'] as Map)
        : null;
    final summarySteam = summaryPlatforms?['steam'] is Map
        ? Map<String, dynamic>.from(summaryPlatforms!['steam'] as Map)
        : null;

    final steamSnap = bucket['steam'] is Map
        ? Map<String, dynamic>.from(bucket['steam'] as Map)
        : null;

    final indexFinal = indexSummary?['finalPrice'] is num
        ? (indexSummary!['finalPrice'] as num).toDouble()
        : index['finalPrice'] is num
            ? (index['finalPrice'] as num).toDouble()
            : double.tryParse(index['finalPrice']?.toString() ?? '');
    final indexDisc = indexSummary?['discountPercent'] is num
        ? (indexSummary!['discountPercent'] as num).round()
        : index['discountPercent'] is num
            ? (index['discountPercent'] as num).round()
            : int.tryParse(index['discountPercent']?.toString() ?? '') ?? 0;

    double? steamFinal;
    double? steamOrig;
    var steamDisc = indexDisc;
    String steamCur = currency;

    if (summarySteam != null) {
      final fp = summarySteam['finalPrice'] is num
          ? (summarySteam['finalPrice'] as num).toDouble()
          : double.tryParse('${summarySteam['finalPrice']}');
      final op = summarySteam['originalPrice'] is num
          ? (summarySteam['originalPrice'] as num).toDouble()
          : double.tryParse('${summarySteam['originalPrice']}');
      final c = summarySteam['currency']?.toString().trim().toUpperCase();
      if (c != null && c.isNotEmpty) steamCur = c;
      if (fp != null) {
        steamFinal = normalizeDealPriceAmount(fp, steamCur) ?? fp;
      }
      if (op != null) {
        steamOrig = normalizeDealPriceAmount(op, steamCur) ?? op;
      }
      if (summarySteam['discountPercent'] is num) {
        steamDisc = (summarySteam['discountPercent'] as num).round();
      }
    }

    if (steamFinal == null && steamSnap != null) {
      final steamFinalRaw = steamSnap['finalPrice'] is num
          ? steamSnap['finalPrice'] as num
          : indexFinal;
      final steamOrigRaw = steamSnap['originalPrice'] is num
          ? steamSnap['originalPrice'] as num
          : null;
      steamCur = steamSnap['currency']?.toString() ?? currency;
      if (steamFinalRaw is num) {
        steamFinal = _cellPrice(steamFinalRaw, steamCur, isSteam: true);
      }
      if (steamOrigRaw != null) {
        steamOrig = _cellPrice(steamOrigRaw, steamCur, isSteam: true);
      }
      if (steamSnap['discountPercent'] is num) {
        steamDisc = (steamSnap['discountPercent'] as num).round();
      }
    }

    steamFinal ??=
        indexFinal != null ? (normalizeDealPriceAmount(indexFinal, currency) ?? indexFinal) : null;
    steamOrig ??= _originalFromFinal(steamFinal, steamDisc);

    final steamStoreUrl = indexSummary?['steamStoreUrl']?.toString() ??
        summarySteam?['url']?.toString() ??
        steamSnap?['url']?.toString() ??
        detail['steamStoreUrl']?.toString() ??
        '';

    final steamPrice = {
      'currency': steamCur,
      'initial': steamOrig ?? 0,
      'final': steamFinal ?? 0,
      'initialFormatted': formatRegionalPrice(amount: steamOrig, currency: steamCur),
      'finalFormatted': formatRegionalPrice(amount: steamFinal, currency: steamCur),
      'discountPercent': steamDisc,
      'fallbackUsed': false,
      'source': 'steam',
      'steamStoreUrl': steamStoreUrl,
      if (detail['isFree'] == true) 'isFree': true,
    };

    final dealsBySource = <String, Map<String, dynamic>>{};
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
      _putDeal(
        dealsBySource,
        _dealFromPlatformCell(
          source: source,
          cell: Map<String, dynamic>.from(snap),
          cc: cc,
          currency: currency,
          steamMinorUnits: key == 'steam',
        ),
      );
    }

    if (indexSummary != null) {
      for (final d in _dealsFromPriceSummary(indexSummary, cc, currency)) {
        _putDeal(dealsBySource, d);
      }
    }

    if (!dealsBySource.containsKey('steam') &&
        steamFinal != null &&
        steamFinal > 0) {
      _putDeal(dealsBySource, {
        'source': 'steam',
        'url': steamStoreUrl,
        'finalPrice': steamFinal,
        'originalPrice': steamOrig ?? steamFinal,
        'discountPercent': steamDisc,
        'currency': steamCur,
        'countryCode': cc,
      });
    }

    final localDeals = dealsBySource.values.toList();

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
