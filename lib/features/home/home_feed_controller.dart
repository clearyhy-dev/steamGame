import 'package:flutter/foundation.dart';

import '../../core/schedule_config.dart';
import '../../core/services/algorithm_service.dart';
import '../../core/services/cache_service.dart';
import '../../core/services/game_service.dart';
import '../../core/storage_service.dart';
import '../../core/app_country_resolver.dart';
import '../../core/utils/price_region_resolver.dart';
import '../../core/utils/score_calculator.dart';
import '../../models/game_model.dart';
import '../../services/steam_backend_service.dart';
import '../recommendation/models/recommended_item.dart';

/// 首页数据：本地折扣缓存、统计快照、愿望单决策（个性化推荐见发现页「为你推荐」）。
class HomeFeedController extends ChangeNotifier {
  HomeFeedController({
    GameService? gameService,
    SteamBackendService? backend,
  })  : _gameService = gameService ?? GameService(),
        _backend = backend ?? SteamBackendService();

  final GameService _gameService;
  final SteamBackendService _backend;

  List<GameModel> deals = [];
  List<GameModel> top10 = [];
  GameModel? topDeal;
  String? updatedAt;

  /// `/v1/stats/summary`，供 Steam 概览卡片。
  Map<String, dynamic>? statsSummary;
  bool statsLoading = false;

  /// 已持有后端 JWT（与是否绑定 Steam 无关）。
  bool hasBackendToken = false;

  /// `/api/steam/friends/status`：好友总数与在线数（personaState != 0）。
  int? steamFriendCount;
  int? steamFriendsOnline;

  bool dealsLoading = false;
  bool queryLimitReached = false;
  bool isPro = false;

  String? welcomeDisplayName;
  bool steamLinkedUi = false;

  /// 切换应用国家后先清空列表，避免短暂显示上一地区的缓存价格。
  void clearDealListsForCountryChange() {
    deals = [];
    top10 = [];
    topDeal = null;
    notifyListeners();
  }

  /// [showSteamSectionLoading]：为 false 时仍拉取 Steam 摘要，但不置 `statsLoading`（避免与 `RefreshIndicator` 双转圈）。
  Future<void> load({bool showSteamSectionLoading = true}) async {
    final region = await AppCountryResolver.resolveContext();
    final countryCode = region.countryCode;
    final storage = StorageService.instance;
    isPro = await storage.isPro();
    queryLimitReached = false;

    final cache = CacheService();
    final cached = await cache.getCachedGames(countryCode: countryCode);
    final lastCheck = await cache.getLastCheckTime(countryCode: countryCode);
    final isNewDay =
        ScheduleConfig.isNewDayInLocale(lastCheck, region.uiLanguageCode);
    if (cached.isNotEmpty && !isNewDay) {
      _applyDeals(deduplicateDeals(cached));
    }
    updatedAt = lastCheck;
    notifyListeners();

    queryLimitReached = false;
    final canFetch = true;

    if (canFetch) {
      dealsLoading = true;
      notifyListeners();
      try {
        final token = await storage.getSteamBackendToken();
        List<GameModel> latest = const [];
        if (token != null && token.isNotEmpty) {
          try {
            final lang = await PriceRegionResolver.effectiveSteamUiLanguage();
            final rec =
                await _backend.getHomeRecommendations(token,
                    country: countryCode, language: lang);
            final items = rec['items'] as List<dynamic>? ?? const [];
            latest = items
                .whereType<Map>()
                .map((e) => RecommendedItem.fromJson(
                    Map<String, dynamic>.from(e)).toGameModel())
                .toList();
          } catch (_) {}
        }
        if (latest.isEmpty) {
          try {
            final lang = await PriceRegionResolver.effectiveSteamUiLanguage();
            final pub = await _backend.getTrendingPublicRecommendations(
                country: countryCode, language: lang);
            final items = pub['items'] as List<dynamic>? ?? const [];
            latest = items
                .whereType<Map>()
                .map((e) => RecommendedItem.fromJson(
                    Map<String, dynamic>.from(e)).toGameModel())
                .toList();
          } catch (_) {}
        }
        if (latest.isEmpty) {
          latest = await _gameService.fetchGames(
            pageSize: 60,
            country: countryCode,
          );
        }
        if (latest.isNotEmpty) {
          final deduped = deduplicateDeals(latest);
          await cache.saveGames(deduped, countryCode: countryCode);
          _applyDeals(deduped);
          updatedAt = await cache.getLastCheckTime(countryCode: countryCode);
        }
      } finally {
        dealsLoading = false;
        notifyListeners();
      }
    }

    final prof = await storage.getSteamProfileCache();
    final sid = (prof['steamId'] ?? '').trim();

    final token = await storage.getSteamBackendToken();
    if (token == null || token.isEmpty) {
      hasBackendToken = false;
      statsSummary = null;
      statsLoading = false;
      steamFriendCount = null;
      steamFriendsOnline = null;
      welcomeDisplayName = (prof['personaName'] ?? '').trim().isEmpty
          ? null
          : prof['personaName'];
      steamLinkedUi = sid.isNotEmpty;
      notifyListeners();
      return;
    }

    hasBackendToken = true;
    if (showSteamSectionLoading) {
      statsLoading = true;
      notifyListeners();
    }

    try {
      await Future.wait<void>([
        _loadStats(token),
        _loadFriendSocialStats(token),
      ]);
      _backend.syncSteam(token).catchError((_) {});
      _syncWelcomeAndSteamUi(prof, sid);
    } finally {
      if (showSteamSectionLoading) {
        statsLoading = false;
      }
      notifyListeners();
    }
  }

  Future<void> _loadStats(String token) async {
    try {
      statsSummary = await _backend.getStatsSummary(token);
    } catch (_) {
      statsSummary = null;
    }
  }

  Future<void> _loadFriendSocialStats(String token) async {
    try {
      final friends = await _backend.getFriendsStatus(token);
      steamFriendCount = friends.length;
      var online = 0;
      for (final f in friends) {
        if (f is! Map) continue;
        final ps = f['personaState'];
        final n =
            ps is num ? ps.toInt() : int.tryParse(ps?.toString() ?? '') ?? 0;
        if (n != 0) online++;
      }
      steamFriendsOnline = online;
    } catch (_) {
      steamFriendCount = null;
      steamFriendsOnline = null;
    }
  }

  void _syncWelcomeAndSteamUi(Map<String, String> prof, String sid) {
    final localName = (prof['personaName'] ?? '').trim();
    welcomeDisplayName = localName.isEmpty ? null : localName;
    steamLinkedUi = (statsSummary?['steamLinked'] == true) || sid.isNotEmpty;
  }

  void _applyDeals(List<GameModel> list) {
    deals = list;
    final sorted = AlgorithmService().sortByScore(list);
    topDeal = sorted.isNotEmpty ? sorted.first : null;
    top10 = sorted.length > 1
        ? sorted.skip(1).take(10).toList()
        : <GameModel>[];
  }
}
