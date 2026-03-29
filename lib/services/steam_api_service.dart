import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../core/constants.dart';
import '../core/current_players_cache.dart';
import '../models/game_model.dart';

/// 使用 CheapShark 公开 API 获取折扣列表与详情
/// 文档: https://apidocs.cheapshark.com/
class SteamApiService {
  static const String _baseUrl = 'https://www.cheapshark.com/api/1.0';

  /// 与 SteamDB 排行榜一致：常驻 Top 的 Steam appId（按典型人气排序，后续会按实时在线人数重排）
  static const List<String> topSteamAppIds = [
    '730',    // Counter-Strike 2
    '570',    // Dota 2
    '578080', // PUBG
    '271590', // GTA V
    '1085660',// Destiny 2
    '1172470',// Apex Legends
    '252490', // Rust
    '1938090',// Call of Duty
    '1245620',// Elden Ring
    '109150', // Cyberpunk 2077
    '292030', // Witcher 3
    '431960', // Wallpaper Engine
    '1599340',// Lost Ark
    '552520', // Sea of Thieves
    '381210', // Dead by Daylight
    '359550', // Rainbow Six Siege
    '1222670',// The Sims 4
    '1174180',// Red Dead Redemption 2
    '739630', // Phasmophobia
    '1811260',// EA Sports FC 25
  ];

  /// 拉取「免费玩」列表（CheapShark 支持 upperPrice=0 筛选）
  Future<List<GameModel>> fetchFreeDeals({int pageSize = 30}) async {
    try {
      final uri = Uri.parse('$_baseUrl/deals').replace(
        queryParameters: <String, String>{
          'upperPrice': '0',
          'pageSize': pageSize.toString(),
        },
      );
      final response = await http.get(uri).timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw Exception('Free deals request timeout'),
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data is List) {
          return data
              .map((e) => GameModel.fromCheapSharkDeal(Map<String, dynamic>.from(e as Map)))
              .toList();
        }
      }
    } catch (e) {
      debugPrint('fetchFreeDeals error: $e');
    }
    return [];
  }

  /// 从 Steam 商店拉取单款游戏简要信息（name + header_image），用于「最多人在玩」列表
  Future<GameModel?> fetchSteamAppDetails(String appId) async {
    if (appId.isEmpty) return null;
    try {
      final uri = Uri.parse('https://store.steampowered.com/api/appdetails').replace(
        queryParameters: <String, String>{'appids': appId, 'l': 'en'},
      );
      final response = await http.get(uri).timeout(
        const Duration(seconds: 6),
        onTimeout: () => throw Exception('Steam appdetails timeout'),
      );
      if (response.statusCode != 200) return null;
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final appData = data[appId];
      if (appData is! Map<String, dynamic> || appData['success'] != true) return null;
      final gameData = appData['data'] as Map<String, dynamic>?;
      if (gameData == null) return null;
      return GameModel.fromSteamAppDetails(appId, gameData);
    } catch (e) {
      debugPrint('fetchSteamAppDetails $appId error: $e');
      return null;
    }
  }

  /// 拉取「最多人在玩」：Top 15 appIds 拉取名称+头图与当前在线人数，按在线人数排序（与 SteamDB 一致）
  Future<List<GameModel>> fetchTopGamesByCurrentPlayers({int limit = 15}) async {
    final ids = topSteamAppIds.take(limit).toList();
    final list = <GameModel>[];
    const batchSize = 5;
    for (var i = 0; i < ids.length; i += batchSize) {
      final batch = ids.skip(i).take(batchSize).toList();
      final details = await Future.wait(batch.map((id) => fetchSteamAppDetails(id)));
      for (final g in details) {
        if (g != null && g.steamAppID.isNotEmpty) list.add(g);
      }
      if (batch.length == batchSize) await Future<void>.delayed(const Duration(milliseconds: 400));
    }
    for (var j = 0; j < list.length; j += batchSize) {
      final batch = list.skip(j).take(batchSize).toList();
      await Future.wait(batch.map((g) async {
        final c = await fetchCurrentPlayers(g.steamAppID);
        if (c != null) CurrentPlayersCache.set(g.steamAppID, c);
      }));
      if (batch.length == batchSize) await Future<void>.delayed(const Duration(milliseconds: 300));
    }
    list.sort((a, b) => (CurrentPlayersCache.get(b.steamAppID) ?? 0).compareTo(CurrentPlayersCache.get(a.steamAppID) ?? 0));
    return list;
  }

  /// 拉取当前折扣列表（分页），5 秒超时防止卡死
  Future<List<GameModel>> fetchDeals({int pageSize = 25, int pageNumber = 0}) async {
    try {
      final uri = Uri.parse('$_baseUrl/deals').replace(
        queryParameters: <String, String>{
          'pageSize': pageSize.toString(),
          'pageNumber': pageNumber.toString(),
        },
      );
      final response = await http.get(uri).timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw Exception('Deals request timeout'),
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data is List) {
          return data
              .map((e) => GameModel.fromCheapSharkDeal(Map<String, dynamic>.from(e as Map)))
              .toList();
        }
      }
    } catch (e) {
      debugPrint('fetchDeals error: $e');
    }
    return [];
  }

  /// 按 dealID 拉取单条折扣详情（用于详情页）
  Future<GameModel> fetchGameById(String dealId) async {
    if (dealId.isEmpty) return _emptyGame('');
    try {
      final uri = Uri.parse('$_baseUrl/deals').replace(
        queryParameters: <String, String>{'id': dealId},
      );
      final response = await http.get(uri).timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw Exception('Detail request timeout'),
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body) as Map<String, dynamic>;
        final gameInfo = data['gameInfo'] as Map<String, dynamic>?;
        if (gameInfo != null) {
          return GameModel.fromCheapSharkGameInfo(dealId, gameInfo);
        }
      }
    } catch (e) {
      debugPrint('fetchGameById error: $e');
    }
    return _emptyGame(dealId);
  }

  Future<GameModel> fetchGameDetail(String appId) async {
    return fetchGameById(appId);
  }

  GameModel _emptyGame(String id) {
    return GameModel(
      appId: id,
      name: 'Game #$id',
      image: '',
      price: 0,
      originalPrice: 0,
      discount: 0,
    );
  }

  /// 从 Steam 商店 API 拉取游戏截图（多图轮播用），返回 path_full 列表，最多 12 张
  Future<List<String>> fetchSteamScreenshots(String steamAppID) async {
    if (steamAppID.isEmpty) return [];
    try {
      final uri = Uri.parse('https://store.steampowered.com/api/appdetails').replace(
        queryParameters: <String, String>{'appids': steamAppID, 'l': 'en'},
      );
      final response = await http.get(uri).timeout(
        const Duration(seconds: 6),
        onTimeout: () => throw Exception('Steam store timeout'),
      );
      if (response.statusCode != 200) return [];
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final appData = data[steamAppID];
      if (appData is! Map<String, dynamic>) return [];
      final success = appData['success'];
      if (success != true) return [];
      final gameData = appData['data'] as Map<String, dynamic>?;
      if (gameData == null) return [];
      final screenshots = gameData['screenshots'];
      if (screenshots is! List || screenshots.isEmpty) return [];
      final urls = <String>[];
      for (final s in screenshots.take(12)) {
        if (s is Map && s['path_full'] != null) {
          urls.add(s['path_full'].toString());
        }
      }
      return urls;
    } catch (e) {
      debugPrint('fetchSteamScreenshots error: $e');
      return [];
    }
  }

  /// Steam 官方接口：当前在线人数（与 SteamDB 图表同源，无需 API Key）
  /// 文档: https://partner.steamgames.com/doc/webapi/ISteamUserStats#GetNumberOfCurrentPlayers
  Future<int?> fetchCurrentPlayers(String steamAppID) async {
    if (steamAppID.isEmpty) return null;
    try {
      final uri = Uri.parse(
        'https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/',
      ).replace(queryParameters: <String, String>{'appid': steamAppID});
      final response = await http.get(uri).timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw Exception('Current players timeout'),
      );
      if (response.statusCode != 200) return null;
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final responseInner = data['response'];
      if (responseInner is! Map<String, dynamic>) return null;
      final count = responseInner['player_count'];
      if (count is int) return count;
      if (count is num) return count.toInt();
      return null;
    } catch (e) {
      debugPrint('fetchCurrentPlayers error: $e');
      return null;
    }
  }

  /// Steam 评测单项（内容、作者、点赞数、时间、语言）
  static Map<String, dynamic> parseReview(Map<String, dynamic> r) {
    final author = r['author'];
    final authorStr = author is Map
        ? (author['steamid']?.toString() ?? 'User')
        : (author?.toString().isNotEmpty == true ? author.toString() : 'User');
    final ts = r['timestamp_created'];
    final created = ts is int ? ts : (ts is num ? ts.toInt() : int.tryParse(ts?.toString() ?? '0') ?? 0);
    final updated = r['timestamp_updated'];
    final updatedSec = updated is int ? updated : (updated is num ? updated.toInt() : int.tryParse(updated?.toString() ?? '0') ?? 0);
    return {
      'content': r['review']?.toString().replaceAll(RegExp(r'<[^>]*>'), '').trim() ?? '',
      'author': authorStr,
      'votes_up': (r['votes_up'] is int) ? r['votes_up'] as int : int.tryParse(r['votes_up']?.toString() ?? '0') ?? 0,
      'voted_up': r['voted_up'] == true,
      'language': r['language']?.toString() ?? '',
      'timestamp_created': created,
      'timestamp_updated': updatedSec > 0 ? updatedSec : created,
    };
  }

  static int _intField(dynamic v) {
    if (v is int) return v;
    if (v is num) return v.toInt();
    return int.tryParse(v?.toString() ?? '0') ?? 0;
  }

  /// Steam 商店用户评价（公开 `appreviews` 接口），**不需要**用户 Steam 登录 token。
  /// 返回 [query_summary] 聚合数据 + 按发布时间倒序的最近 [latestN] 条评测。
  /// 文档: https://store.steampowered.com/appreviews/{appid}?json=1
  Future<({List<Map<String, dynamic>> reviews, Map<String, dynamic>? summary})> fetchSteamReviews(
    String steamAppID, {
    int latestN = 10,
  }) async {
    if (steamAppID.isEmpty) {
      return (reviews: <Map<String, dynamic>>[], summary: null);
    }
    try {
      final uri = Uri.parse('https://store.steampowered.com/appreviews/$steamAppID').replace(
        queryParameters: <String, String>{
          'json': '1',
          'language': 'all',
          'num_per_page': '100',
          'filter': 'recent',
        },
      );
      final response = await http.get(uri).timeout(
        const Duration(seconds: 10),
        onTimeout: () => throw Exception('Steam reviews timeout'),
      );
      if (response.statusCode != 200) {
        return (reviews: <Map<String, dynamic>>[], summary: null);
      }
      final data = jsonDecode(response.body) as Map<String, dynamic>;
      final success = data['success'];
      if (success != 1 && success != true) {
        return (reviews: <Map<String, dynamic>>[], summary: null);
      }

      Map<String, dynamic>? summary;
      final qs = data['query_summary'];
      if (qs is Map<String, dynamic>) {
        final tp = _intField(qs['total_positive']);
        final tn = _intField(qs['total_negative']);
        final denom = tp + tn;
        final pct = denom > 0 ? ((tp * 100) / denom).round() : 0;
        final numReviews = _intField(qs['num_reviews']);
        summary = {
          'review_score_desc': qs['review_score_desc']?.toString() ?? '',
          'positive_percent': pct,
          'total_reviews': numReviews > 0 ? numReviews : denom,
          'total_positive': tp,
          'total_negative': tn,
        };
      }

      final reviewsRaw = data['reviews'];
      if (reviewsRaw is! List || reviewsRaw.isEmpty) {
        return (reviews: <Map<String, dynamic>>[], summary: summary);
      }
      final list = <Map<String, dynamic>>[];
      for (final r in reviewsRaw) {
        if (r is Map) {
          final m = Map<String, dynamic>.from(r);
          final row = parseReview(m);
          if ((row['content'] as String).isNotEmpty) list.add(row);
        }
      }
      list.sort((a, b) {
        final ta = (a['timestamp_created'] as int?) ?? 0;
        final tb = (b['timestamp_created'] as int?) ?? 0;
        return tb.compareTo(ta);
      });
      final take = list.take(latestN).toList();
      return (reviews: take, summary: summary);
    } catch (e) {
      debugPrint('fetchSteamReviews error: $e');
      return (reviews: <Map<String, dynamic>>[], summary: null);
    }
  }

  /// 价格历史折线图用：无真实 API 时用当前价+原价构造两点（过去→现在）
  List<Map<String, dynamic>> getPriceHistoryPoints(double currentPrice, double originalPrice, {int lastChangeSec = 0}) {
    final now = DateTime.now();
    final past = lastChangeSec > 0
        ? DateTime.fromMillisecondsSinceEpoch(lastChangeSec * 1000)
        : now.subtract(const Duration(days: 30));
    return [
      {'t': past.millisecondsSinceEpoch, 'price': originalPrice},
      {'t': now.millisecondsSinceEpoch, 'price': currentPrice},
    ];
  }

  /// 优先拉取 IsThereAnyDeal 真实价格历史；无 key 或失败时返回 fallback 两点
  Future<List<Map<String, dynamic>>> fetchPriceHistory(
    String steamAppID,
    double currentPrice,
    double originalPrice, {
    int lastChangeSec = 0,
  }) async {
    if (AppConstants.itadApiKey.trim().isNotEmpty && steamAppID.isNotEmpty) {
      final fromItad = await fetchPriceHistoryFromItad(steamAppID);
      if (fromItad.isNotEmpty) return fromItad;
    }
    return getPriceHistoryPoints(
      currentPrice,
      originalPrice > 0 ? originalPrice : currentPrice,
      lastChangeSec: lastChangeSec,
    );
  }

  static const String _itadBase = 'https://api.isthereanydeal.com';

  /// IsThereAnyDeal：先 lookup 再取 history，返回 [ {t: ms, price}, ... ]
  Future<List<Map<String, dynamic>>> fetchPriceHistoryFromItad(String steamAppID) async {
    final key = AppConstants.itadApiKey.trim();
    if (key.isEmpty) return [];
    try {
      final lookupUri = Uri.parse('$_itadBase/v01/games/lookup/v1').replace(
        queryParameters: <String, String>{'key': key, 'appid': steamAppID},
      );
      final lookupResp = await http.get(lookupUri).timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw Exception('ITAD lookup timeout'),
      );
      if (lookupResp.statusCode != 200) return [];
      final lookupData = jsonDecode(lookupResp.body) as Map<String, dynamic>;
      final game = lookupData['data'] ?? lookupData['game'];
      if (game is! Map<String, dynamic>) return [];
      final plain = game['plain']?.toString() ?? game['id']?.toString();
      if (plain == null || plain.isEmpty) return [];

      final historyUri = Uri.parse('$_itadBase/v01/game/history/').replace(
        queryParameters: <String, String>{'key': key, 'plain': plain, 'region': 'us', 'country': 'US'},
      );
      final historyResp = await http.get(historyUri).timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw Exception('ITAD history timeout'),
      );
      if (historyResp.statusCode != 200) return [];
      final historyData = jsonDecode(historyResp.body) as Map<String, dynamic>;
      final list = historyData['data'] ?? historyData['list'] ?? historyData['history'];
      if (list is! List || list.isEmpty) return [];

      final points = <Map<String, dynamic>>[];
      for (final e in list) {
        if (e is! Map<String, dynamic>) continue;
        final priceVal = (e['price'] is num) ? (e['price'] as num).toDouble() : double.tryParse(e['price']?.toString() ?? '');
        final amountVal = (e['amount'] is num) ? (e['amount'] as num).toDouble() : double.tryParse(e['amount']?.toString() ?? '');
        final value = priceVal ?? amountVal;
        if (value == null) continue;
        final dateStr = e['date']?.toString() ?? e['timestamp']?.toString();
        int tMs = 0;
        if (dateStr != null && dateStr.isNotEmpty) {
          final dt = DateTime.tryParse(dateStr);
          if (dt != null) tMs = dt.millisecondsSinceEpoch;
        }
        if (tMs == 0 && e['ts'] != null) tMs = (e['ts'] is int) ? (e['ts'] as int) * 1000 : (int.tryParse(e['ts']?.toString() ?? '0') ?? 0) * 1000;
        if (tMs == 0) continue;
        points.add({'t': tMs, 'price': value});
      }
      points.sort((a, b) => (a['t'] as int).compareTo(b['t'] as int));
      return points;
    } catch (e) {
      debugPrint('fetchPriceHistoryFromItad error: $e');
      return [];
    }
  }

  /// 按游戏名搜索（CheapShark /games）
  Future<List<GameModel>> searchGames(String title, {int pageSize = 20}) async {
    try {
      final uri = Uri.parse('$_baseUrl/games').replace(
        queryParameters: <String, String>{
          'title': title,
          'pageSize': pageSize.toString(),
        },
      );
      final response = await http.get(uri).timeout(
        const Duration(seconds: 5),
        onTimeout: () => throw Exception('Search request timeout'),
      );
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        if (data is List) {
          final list = <GameModel>[];
          for (final e in data) {
            final m = e as Map<String, dynamic>;
            final dealId = m['cheapestDealID']?.toString();
            final cheapest = m['cheapest']?.toString();
            final titleStr = m['external']?.toString() ?? m['internalName']?.toString() ?? '';
            final steamId = m['steamAppID']?.toString();
            final thumb = m['thumb']?.toString();
            if (dealId != null && dealId.isNotEmpty) {
              list.add(GameModel(
                appId: dealId,
                dealID: dealId,
                name: titleStr,
                image: thumb ?? '',
                price: cheapest != null ? double.tryParse(cheapest) ?? 0 : 0,
                originalPrice: 0,
                discount: 0,
                steamAppID: steamId ?? '',
              ));
            }
          }
          return list;
        }
      }
    } catch (e) {
      debugPrint('searchGames error: $e');
    }
    return [];
  }
}
