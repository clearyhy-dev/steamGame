import 'package:flutter/foundation.dart';

import '../../core/access_control.dart';
import '../../core/schedule_config.dart';
import '../../core/services/algorithm_service.dart';
import '../../core/services/cache_service.dart';
import '../../core/services/game_service.dart';
import '../../core/storage_service.dart';
import '../../core/utils/score_calculator.dart';
import '../../models/game_model.dart';
import '../../models/store_offer.dart';
import '../../services/steam_backend_service.dart';

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
  /// 折扣大于 50% 且具备联盟链接（Mock 下恒有）的条目，供「超值入手」横滑列表。
  List<GameModel> bestDealsToBuy = [];
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

  /// [showSteamSectionLoading]：为 false 时仍拉取 Steam 摘要，但不置 `statsLoading`（避免与 `RefreshIndicator` 双转圈）。
  Future<void> load({bool showSteamSectionLoading = true}) async {
    final storage = StorageService.instance;
    isPro = await storage.isPro();
    queryLimitReached = !(await AccessControl().canSearchToday());

    final cache = CacheService();
    final cached = await cache.getCachedGames();
    final lastCheck = await cache.getLastCheckTime();
    final locale = await storage.getPreferredLocale();
    final isNewDay = ScheduleConfig.isNewDayInLocale(lastCheck, locale);
    if (cached.isNotEmpty && !isNewDay) {
      _applyDeals(deduplicateDeals(cached));
    }
    updatedAt = lastCheck;
    notifyListeners();

    final canSearch = await AccessControl().canSearchToday();
    queryLimitReached = !canSearch;
    final canFetch = canSearch || isNewDay;

    if (canFetch) {
      if (!isNewDay) await storage.incrementQueryCountToday();
      dealsLoading = true;
      notifyListeners();
      try {
        final latest = await _gameService.fetchGames(pageSize: 60);
        if (latest.isNotEmpty) {
          final deduped = deduplicateDeals(latest);
          await cache.saveGames(deduped);
          _applyDeals(deduped);
          updatedAt = await cache.getLastCheckTime();
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
      welcomeDisplayName = (prof['personaName'] ?? '').trim().isEmpty ? null : prof['personaName'];
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
        final n = ps is num ? ps.toInt() : int.tryParse(ps?.toString() ?? '') ?? 0;
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
    top10 = AlgorithmService().topByScore(list, limit: 10);
    topDeal = top10.isNotEmpty ? top10.first : null;
    bestDealsToBuy = list
        .where((g) => g.discount > 50 && hasAffiliateableOffer(g))
        .take(12)
        .toList();
  }
}
