import 'dart:async';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import '../../../core/access_control.dart';
import '../../../core/current_players_cache.dart';
import '../../../core/theme/colors.dart';
import '../../../core/shock_deal_algorithm.dart';
import '../../../core/utils/score_calculator.dart' as score_util;
import '../../../core/services/analytics_service.dart';
import '../../../core/storage_service.dart';
import '../../../core/schedule_config.dart';
import '../../../data/services/cache_service.dart';
import '../../../data/services/api_service.dart';
import '../../../l10n/app_localizations.dart';
import '../../../models/game_model.dart';
import '../../../models/store_offer.dart';
import '../../../screens/search_screen.dart';
import '../../../services/steam_api_service.dart';
import '../../../services/steam_backend_service.dart';
import '../../core/steam_auth_events.dart';
import '../recommendation/models/recommended_item.dart';
import '../detail/game_detail_page.dart';
import '../subscription/subscription_page.dart';
import '../home/widgets/home_best_deals_to_buy_section.dart';
import 'widgets/game_card_small.dart';

/// Explore：顶部搜索 → 分类胶囊 Tab → 内容。「趋势」为本地流 + 后端趋势精选；其余 Tab 为对应后端列表。
class ExplorePage extends StatefulWidget {
  const ExplorePage({super.key});

  @override
  State<ExplorePage> createState() => _ExplorePageState();
}

class _ExplorePageState extends State<ExplorePage> with SingleTickerProviderStateMixin {
  List<GameModel> _deals = [];
  List<GameModel> _freeDeals = [];
  List<GameModel> _mostPlayedGlobal = [];
  DealCategories? _cat;
  /// 与首页原逻辑一致：高折扣 + 可联盟购买，供「超值入手」横滑列表（趋势 Tab）。
  List<GameModel> _bestDealsToBuy = [];
  bool _loading = true;
  bool _queryLimitReached = false;
  final _searchController = TextEditingController();

  late TabController _tabController;
  List<GameModel> _exploreFeed = [];
  bool _exploreLoading = false;
  String? _backendToken;
  StreamSubscription<SteamAuthSuccessPayload>? _steamAuthSub;

  /// 本地筛选（客户端过滤列表，不额外请求）
  double _filterMinDiscount = 0;
  double _filterMaxPrice = 120;

  /// 与 UI Tab 顺序一致：趋势 → 为你推荐 → 深度折扣 → 隐藏佳作
  static const List<String> _exploreTabKeys = ['trending', 'for_you', 'deep', 'hidden'];

  bool _passesDealFilter(GameModel g) {
    if (g.discount < _filterMinDiscount.round()) return false;
    if (g.price > _filterMaxPrice) return false;
    return true;
  }

  List<GameModel> _filterGames(List<GameModel> list) {
    if (list.isEmpty) return list;
    return list.where(_passesDealFilter).toList();
  }

  @override
  void initState() {
    super.initState();
    _tabController = TabController(length: 4, vsync: this);
    _tabController.addListener(_onExploreTabChanged);
    _steamAuthSub = SteamAuthEvents.instance.stream.listen((_) async {
      if (!mounted) return;
      await _load(forceRefresh: false);
      if (mounted) await _loadExploreTab(_tabController.index);
    });
    _load().then((_) {
      if (mounted) _loadExploreTab(_tabController.index);
    });
  }

  void _onExploreTabChanged() {
    if (_tabController.indexIsChanging) return;
    _loadExploreTab(_tabController.index);
  }

  Future<void> _loadExploreTab(int index) async {
    if (index < 0 || index >= _exploreTabKeys.length) return;
    try {
      _backendToken = await StorageService.instance.getSteamBackendToken();
    } catch (_) {
      _backendToken = null;
    }
    final token = _backendToken;
    if (token == null || token.isEmpty) {
      if (mounted) setState(() => _exploreFeed = []);
      return;
    }
    if (mounted) setState(() => _exploreLoading = true);
    try {
      final data = await SteamBackendService().getExploreRecommendations(
        token,
        tab: _exploreTabKeys[index],
      );
      final raw = data['items'] as List<dynamic>? ?? [];
      final games = raw
          .map((e) => RecommendedItem.fromJson(Map<String, dynamic>.from(e as Map)).toGameModel())
          .toList();
      if (mounted) {
        setState(() {
          _exploreFeed = games;
          _exploreLoading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _exploreFeed = [];
          _exploreLoading = false;
        });
      }
    }
  }

  @override
  void dispose() {
    _steamAuthSub?.cancel();
    _tabController.removeListener(_onExploreTabChanged);
    _tabController.dispose();
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _load({bool forceRefresh = false}) async {
    try {
      _backendToken = await StorageService.instance.getSteamBackendToken();
    } catch (_) {
      _backendToken = null;
    }
    var list = await CacheService.loadGames();
    final lastCheck = await CacheService.getLastCheckTime();
    final locale = await StorageService.instance.getPreferredLocale();
    final isNewDay = ScheduleConfig.isNewDayInLocale(lastCheck, locale);
    final canSearch = await AccessControl().canSearchToday();
    final canFetch = forceRefresh
        ? (canSearch || isNewDay)
        : ((list.isEmpty || isNewDay) && (canSearch || isNewDay));
    if (list.isEmpty || isNewDay || forceRefresh) {
      if (canFetch) {
        if (!isNewDay) await StorageService.instance.incrementQueryCountToday();
        final fetched = await ApiService.fetchDeals(pageSize: 60);
        if (fetched.isNotEmpty) {
          list = ShockDealAlgorithm.deduplicateDeals(fetched);
          await CacheService.saveGames(list);
        } else if (list.isEmpty && mounted) {
          _showLoadFailed(AppLocalizations.of(context).get('no_deals_refresh'));
        }
      } else if (forceRefresh && !canSearch && !isNewDay && mounted) {
        _showLoadFailed(AppLocalizations.of(context).get('daily_limit_reached'));
      }
    }
    final api = SteamApiService();
    List<GameModel> freeList = [];
    List<GameModel> mostPlayed = [];
    try {
      final results = await Future.wait<List<GameModel>>([
        api.fetchFreeDeals(pageSize: 30),
        api.fetchTopGamesByCurrentPlayers(limit: 15),
      ]);
      freeList = results[0];
      mostPlayed = results[1];
    } catch (_) {
      try { freeList = await api.fetchFreeDeals(pageSize: 30); } catch (_) {}
    }
    if (!mounted) return;
    final bestBuy = list
        .where((g) => g.discount > 50 && hasAffiliateableOffer(g))
        .take(12)
        .toList();
    setState(() {
      _deals = list;
      _freeDeals = freeList;
      _mostPlayedGlobal = mostPlayed;
      _cat = list.isNotEmpty ? ShockDealAlgorithm.computeCategories(list) : null;
      _bestDealsToBuy = bestBuy;
      _queryLimitReached = list.isEmpty && !canSearch && !isNewDay;
      _loading = false;
    });
    if (list.isNotEmpty) WidgetsBinding.instance.addPostFrameCallback((_) => _fetchCurrentPlayersForTopGames());
  }

  void _showLoadFailed(String message) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(message), duration: const Duration(seconds: 3)),
    );
  }

  /// 为 AI 推荐与「最多人在玩」区块拉取当前在线人数并写入缓存
  Future<void> _fetchCurrentPlayersForTopGames() async {
    if (_deals.isEmpty) return;
    final top = score_util.topDealsByScore(_deals, limit: 40);
    final api = SteamApiService();
    const batchSize = 5;
    for (var i = 0; i < top.length; i += batchSize) {
      final batch = top.skip(i).take(batchSize).where((g) => g.steamAppID.isNotEmpty && CurrentPlayersCache.get(g.steamAppID) == null).toList();
      await Future.wait(batch.map((g) async {
        final c = await api.fetchCurrentPlayers(g.steamAppID);
        if (c != null) CurrentPlayersCache.set(g.steamAppID, c);
      }));
    }
    if (mounted) setState(() {});
  }

  Future<void> _openFilterSheet() async {
    final l10n = AppLocalizations.of(context);
    var minD = _filterMinDiscount;
    var maxP = _filterMaxPrice;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.cardDark,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20)),
      ),
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setModal) {
            return Padding(
              padding: EdgeInsets.fromLTRB(20, 16, 20, 24 + MediaQuery.of(ctx).padding.bottom),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    l10n.get('explore_filter_title'),
                    style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600, color: AppColors.textPrimary),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    '${l10n.get('explore_filter_min_discount')}: ${minD.round()}%',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                  ),
                  Slider(
                    value: minD.clamp(0, 90),
                    min: 0,
                    max: 90,
                    divisions: 9,
                    activeColor: AppColors.itadOrange,
                    onChanged: (v) => setModal(() => minD = v),
                  ),
                  Text(
                    '${l10n.get('explore_filter_max_price')}: \$${maxP.toStringAsFixed(0)}',
                    style: const TextStyle(color: AppColors.textSecondary, fontSize: 13),
                  ),
                  Slider(
                    value: maxP.clamp(5, 200),
                    min: 5,
                    max: 200,
                    divisions: 39,
                    activeColor: AppColors.itadOrange,
                    onChanged: (v) => setModal(() => maxP = v),
                  ),
                  const SizedBox(height: 12),
                  Row(
                    children: [
                      TextButton(
                        onPressed: () {
                          setModal(() {
                            minD = 0;
                            maxP = 120;
                          });
                        },
                        child: Text(l10n.get('explore_filter_reset')),
                      ),
                      const Spacer(),
                      FilledButton(
                        onPressed: () {
                          setState(() {
                            _filterMinDiscount = minD;
                            _filterMaxPrice = maxP;
                          });
                          AnalyticsService.instance.logExploreFilterApply(
                            summary: 'minD=${minD.round()} maxP=${maxP.toStringAsFixed(0)}',
                          );
                          Navigator.pop(ctx);
                        },
                        style: FilledButton.styleFrom(backgroundColor: AppColors.itadOrange, foregroundColor: Colors.black),
                        child: Text(l10n.get('explore_filter_apply')),
                      ),
                    ],
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  void _openDetail(GameModel game) {
    Navigator.of(context).push(
      PageRouteBuilder(
        pageBuilder: (_, __, ___) => GameDetailPage(game: game),
        transitionsBuilder: (_, a, __, c) => FadeTransition(opacity: a, child: c),
        transitionDuration: const Duration(milliseconds: 200),
      ),
    );
  }

  /// 深度折扣 / 隐藏佳作 / 为你推荐：仅展示当前 Tab 对应的后端列表（与「趋势」下本地分类流区分）。
  Widget _buildBackendTabBody(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    if (_backendToken == null || _backendToken!.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            l10n.get('explore_for_you_sign_in'),
            textAlign: TextAlign.center,
            style: const TextStyle(fontSize: 14, color: AppColors.textSecondary, height: 1.4),
          ),
        ),
      );
    }
    if (_exploreLoading) {
      return const Center(child: CircularProgressIndicator());
    }
    final games = _filterGames(_exploreFeed);
    if (games.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                l10n.get('rec_empty'),
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 14, color: AppColors.textSecondary, height: 1.4),
              ),
              const SizedBox(height: 16),
              TextButton(
                onPressed: () => _loadExploreTab(_tabController.index),
                child: Text(l10n.get('retry')),
              ),
            ],
          ),
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: () => _loadExploreTab(_tabController.index),
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
        itemCount: games.length,
        separatorBuilder: (_, __) => const SizedBox(height: 10),
        itemBuilder: (context, i) {
          final g = games[i];
          return Material(
            color: AppColors.cardDark,
            borderRadius: BorderRadius.circular(14),
            child: InkWell(
              onTap: () => _openDetail(g),
              borderRadius: BorderRadius.circular(14),
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(8),
                      child: g.image.isNotEmpty
                          ? CachedNetworkImage(
                              imageUrl: g.image,
                              width: 96,
                              height: 54,
                              fit: BoxFit.cover,
                              placeholder: (_, __) => const ColoredBox(
                                color: AppColors.bgDark,
                                child: SizedBox(width: 96, height: 54),
                              ),
                              errorWidget: (_, __, ___) => const ColoredBox(
                                color: AppColors.bgDark,
                                child: SizedBox(width: 96, height: 54),
                              ),
                            )
                          : const ColoredBox(
                              color: AppColors.bgDark,
                              child: SizedBox(width: 96, height: 54),
                            ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            g.name,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                            style: const TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: AppColors.textPrimary,
                              height: 1.25,
                            ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            '-${g.discount}%  \$${g.price.toStringAsFixed(2)}',
                            style: const TextStyle(fontSize: 13, color: AppColors.itadOrange),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildExploreCategoryChip({
    required String label,
    required bool selected,
    required VoidCallback onTap,
  }) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(20),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 180),
          curve: Curves.easeOutCubic,
          padding: const EdgeInsets.symmetric(horizontal: 13, vertical: 8),
          constraints: const BoxConstraints(minHeight: 36),
          decoration: BoxDecoration(
            color: selected
                ? AppColors.itadOrange.withValues(alpha: 0.18)
                : AppColors.cardDark.withValues(alpha: 0.95),
            borderRadius: BorderRadius.circular(20),
            border: Border.all(
              color: selected
                  ? AppColors.itadOrange.withValues(alpha: 0.42)
                  : Colors.white.withValues(alpha: 0.08),
            ),
            boxShadow: selected
                ? [
                    BoxShadow(
                      color: AppColors.itadOrange.withValues(alpha: 0.12),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    ),
                  ]
                : null,
          ),
          child: Align(
            alignment: Alignment.center,
            child: Text(
              label,
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: selected ? FontWeight.w700 : FontWeight.w500,
                letterSpacing: -0.2,
                height: 1.15,
                color: selected ? AppColors.itadOrange : AppColors.textSecondary,
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _section(BuildContext context, String titleKey, List<GameModel> games, {bool showPlayersOnCard = false}) {
    if (games.isEmpty) return const SizedBox.shrink();
    final title = AppLocalizations.of(context).get(titleKey);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Text(
            title,
            style: const TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary,
            ),
          ),
        ),
        SizedBox(
          height: 200,
          child: ListView.builder(
            scrollDirection: Axis.horizontal,
            itemCount: games.length,
            itemBuilder: (_, i) => GameCardSmall(
              game: games[i],
              onTap: () => _openDetail(games[i]),
              showCurrentPlayers: showPlayersOnCard,
            ),
          ),
        ),
        const SizedBox(height: 24),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        bottom: false,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 8, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Text(
                      l10n.get('explore_tab'),
                      style: const TextStyle(
                        fontSize: 22,
                        fontWeight: FontWeight.w700,
                        letterSpacing: -0.3,
                        color: AppColors.textPrimary,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: l10n.get('explore_filter_title'),
                    icon: Stack(
                      clipBehavior: Clip.none,
                      alignment: Alignment.center,
                      children: [
                        Icon(Icons.tune_rounded, color: AppColors.textSecondary.withValues(alpha: 0.9)),
                        if (_filterMinDiscount > 2 || _filterMaxPrice < 115)
                          Positioned(
                            right: -2,
                            top: -2,
                            child: Container(
                              width: 8,
                              height: 8,
                              decoration: const BoxDecoration(color: AppColors.itadOrange, shape: BoxShape.circle),
                            ),
                          ),
                      ],
                    ),
                    onPressed: _openFilterSheet,
                  ),
                ],
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 14, 16, 10),
              child: DecoratedBox(
                decoration: BoxDecoration(
                  color: AppColors.card,
                  borderRadius: BorderRadius.circular(999),
                  border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.25),
                      blurRadius: 12,
                      offset: const Offset(0, 4),
                    ),
                  ],
                ),
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(999),
                  child: SizedBox(
                    height: 48,
                    child: TextField(
                      controller: _searchController,
                      textAlignVertical: TextAlignVertical.center,
                      style: const TextStyle(color: AppColors.textPrimary, fontSize: 15),
                      cursorHeight: 20,
                      decoration: InputDecoration(
                        isDense: true,
                        hintText: l10n.get('search_hint'),
                        hintStyle: TextStyle(color: AppColors.textSecondary.withValues(alpha: 0.85)),
                        prefixIcon: Icon(Icons.search_rounded, color: AppColors.itadOrange.withValues(alpha: 0.95), size: 22),
                        prefixIconConstraints: const BoxConstraints(minWidth: 48, minHeight: 48),
                        border: InputBorder.none,
                        contentPadding: const EdgeInsets.fromLTRB(0, 0, 16, 0),
                      ),
                      onSubmitted: (q) {
                        if (q.trim().isEmpty) return;
                        Navigator.of(context).push(
                          PageRouteBuilder(
                            pageBuilder: (_, __, ___) => const SearchScreen(),
                            transitionsBuilder: (_, a, __, c) => FadeTransition(opacity: a, child: c),
                            transitionDuration: const Duration(milliseconds: 200),
                          ),
                        );
                      },
                    ),
                  ),
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(10, 4, 10, 6),
              child: AnimatedBuilder(
                animation: _tabController,
                builder: (context, _) {
                  final labels = [
                    l10n.get('explore_tab_trending'),
                    l10n.get('explore_tab_for_you'),
                    l10n.get('explore_tab_deep'),
                    l10n.get('explore_tab_hidden'),
                  ];
                  return SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: [
                        for (var i = 0; i < 4; i++) ...[
                          if (i > 0) const SizedBox(width: 8),
                          _buildExploreCategoryChip(
                            label: labels[i],
                            selected: _tabController.index == i,
                            onTap: () {
                              if (_tabController.index != i) {
                                _tabController.animateTo(i);
                              }
                            },
                          ),
                        ],
                      ],
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 2),
            Expanded(
              child: _tabController.index != 0
                ? _buildBackendTabBody(context)
                : _loading
                    ? const Center(child: CircularProgressIndicator())
                    : _queryLimitReached
                        ? Center(
                            child: Padding(
                              padding: const EdgeInsets.all(24),
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                children: [
                                  const Icon(Icons.workspace_premium_outlined, size: 48, color: AppColors.itadOrange),
                                  const SizedBox(height: 16),
                                  Text(AppLocalizations.of(context).get('daily_limit_reached'), style: const TextStyle(color: AppColors.textSecondary)),
                                  const SizedBox(height: 8),
                                  ElevatedButton(
                                    onPressed: () => Navigator.of(context).push(
                                      MaterialPageRoute(builder: (_) => const SubscriptionPage(paywallSource: 'explore')),
                                    ),
                                    child: Text(AppLocalizations.of(context).get('unlock_unlimited')),
                                  ),
                                ],
                              ),
                            ),
                          )
                        : _cat == null
                            ? Center(child: Text(AppLocalizations.of(context).get('no_deals_refresh'), style: const TextStyle(color: AppColors.textSecondary)))
                            : RefreshIndicator(
                                onRefresh: () async {
                                  await _load(forceRefresh: true);
                                  await _loadExploreTab(0);
                                },
                                child: ListView(
                                  padding: const EdgeInsets.symmetric(horizontal: 16),
                                  children: () {
                            final curated = <Widget>[];
                            if (_exploreLoading) {
                              curated.add(const Padding(
                                padding: EdgeInsets.only(bottom: 16),
                                child: Center(child: SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2))),
                              ));
                            } else if (_exploreFeed.isNotEmpty) {
                              curated.add(_section(context, 'explore_curated', _filterGames(_exploreFeed)));
                            } else if (_backendToken == null || _backendToken!.isEmpty) {
                              curated.add(
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 16),
                                  child: Text(
                                    AppLocalizations.of(context).get('explore_for_you_sign_in'),
                                    style: const TextStyle(fontSize: 13, color: AppColors.textSecondary, height: 1.35),
                                  ),
                                ),
                              );
                            }
                            final usedIds = <String>{};
                            final mostPlayedRaw = _mostPlayedGlobal.isNotEmpty
                                ? _mostPlayedGlobal
                                : score_util.uniqueList(
                                    List<GameModel>.from(_deals)
                                      ..sort((a, b) => (CurrentPlayersCache.get(b.steamAppID) ?? 0)
                                          .compareTo(CurrentPlayersCache.get(a.steamAppID) ?? 0)),
                                    usedIds);
                            final mostPlayedList = mostPlayedRaw.take(15).toList();
                            final freeSource = _freeDeals.isNotEmpty
                                ? _freeDeals
                                : _deals.where((g) => g.price <= 0).toList();
                            final freeToPlay = List<GameModel>.from(freeSource)
                              ..sort((a, b) => (b.steamRatingCount).compareTo(a.steamRatingCount));
                            final freeList = score_util.uniqueList(freeToPlay, usedIds);
                            final aiSorted = score_util.topDealsByScore(_deals, limit: 30);
                            final aiList = score_util.uniqueList(aiSorted, usedIds);
                            final newR = score_util.uniqueList(_cat!.newRelease, usedIds);
                            final hidden = score_util.uniqueList(_cat!.hiddenGems, usedIds);
                            final trend = _cat!.trending;
                            final hot = _cat!.todayHot;
                            return [
                              ...curated,
                              _section(context, 'section_just_released', _filterGames(newR)),
                              _section(context, 'section_most_played', _filterGames(mostPlayedList), showPlayersOnCard: true),
                              _section(context, 'section_ai_picks', _filterGames(aiList)),
                              _section(context, 'section_trending_now', _filterGames(trend)),
                              HomeBestDealsToBuySection(
                                games: _bestDealsToBuy,
                                onOpenDetail: _openDetail,
                              ),
                              _section(context, 'section_hidden_gems', _filterGames(hidden)),
                              _section(context, 'section_biggest_discount', _filterGames(hot)),
                              _section(context, 'section_free_to_play', _filterGames(freeList)),
                            ];
                          }(),
                        ),
                      ),
            ),
          ],
        ),
      ),
    );
  }
}

