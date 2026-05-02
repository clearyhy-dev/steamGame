import 'package:flutter/material.dart';
import '../core/storage_service.dart';
import '../core/app_country_events.dart';
import '../core/services/auth_service.dart';
import '../core/theme/colors.dart';
import '../l10n/app_localizations.dart';
import '../models/game_model.dart';
import '../models/wishlist_model.dart';
import '../services/steam_api_service.dart';
import '../services/steam_backend_service.dart';
import '../core/app_country_resolver.dart';
import '../widgets/game_card.dart';
import '../features/subscription/subscription_page.dart';
import '../core/services/analytics_service.dart';
import '../features/detail/game_detail_page.dart';
import '../core/navigation/game_detail_navigation.dart';
import '../features/recommendation/models/recommended_item.dart';

class WishlistScreen extends StatefulWidget {
  const WishlistScreen({super.key, this.currentTabIndex = 0});
  final int currentTabIndex;

  @override
  State<WishlistScreen> createState() => _WishlistScreenState();
}

class _WishlistScreenState extends State<WishlistScreen> {
  final StorageService _storage = StorageService.instance;
  final SteamApiService _api = SteamApiService();
  final SteamBackendService _backend = SteamBackendService();
  List<WishlistItem> _items = [];
  List<GameModel> _deals = [];
  Map<String, int> _lastDiscounts = {};

  /// 后端 `/v1/wishlist/decisions`，key = appid
  Map<String, Map<String, dynamic>> _decisionsByAppId = {};
  bool _loading = true;

  /// 0 默认顺序 1 折扣 2 名称 3 决策优先级
  int _sortMode = 0;
  bool _isLoggedIn = false;
  String _searchQuery = '';
  final TextEditingController _searchController = TextEditingController();

  @override
  void initState() {
    super.initState();
    AppCountryEvents.instance.changed.addListener(_onPriceRegionChanged);
    _checkAuthAndLoad();
    _searchController.addListener(() {
      setState(() => _searchQuery = _searchController.text.trim());
    });
  }

  void _onPriceRegionChanged() {
    _load();
  }

  Future<void> _checkAuthAndLoad() async {
    final googleLoggedIn = await AuthService().isLoggedIn();
    String? steamToken;
    try {
      steamToken = await StorageService.instance.getSteamBackendToken();
    } catch (_) {}
    final hasSteam = steamToken != null && steamToken.isNotEmpty;
    final ok = googleLoggedIn || hasSteam;
    if (mounted) setState(() => _isLoggedIn = ok);
    if (ok) await _load();
  }

  @override
  void dispose() {
    AppCountryEvents.instance.changed.removeListener(_onPriceRegionChanged);
    _searchController.dispose();
    super.dispose();
  }

  @override
  void didUpdateWidget(WishlistScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.currentTabIndex == 2 && oldWidget.currentTabIndex != 2) {
      _checkAuthAndLoad();
    }
  }

  Future<void> _load() async {
    if (!StorageService.instance.isInitialized)
      await StorageService.instance.init();
    List<WishlistItem> items = await _storage.getWishlistItems();
    final region = await AppCountryResolver.resolveContext();
    List<GameModel> deals = const [];
    final token = await StorageService.instance.getSteamBackendToken();
    if (token != null && token.isNotEmpty) {
      try {
        final data = await _backend.getExploreRecommendations(
          token,
          tab: 'trending',
          country: region.countryCode,
        );
        final raw = data['items'] as List<dynamic>? ?? const [];
        deals = raw
            .whereType<Map>()
            .map((e) => RecommendedItem.fromJson(
                Map<String, dynamic>.from(e)).toGameModel())
            .toList();
      } catch (_) {}
    }
    if (deals.isEmpty) {
      deals = await _api.fetchDeals(pageSize: 100, country: region.countryCode);
    }
    final lastDiscounts = await _storage.getLastKnownDiscounts();

    // 当用户完成 Steam 登录后：优先以后端 favorites 为准，进行远程同步到本地。
    final steamToken = await StorageService.instance.getSteamBackendToken();
    if (steamToken != null && steamToken.isNotEmpty) {
      try {
        final remote = await _backend.listFavorites(steamToken);
        final remoteSet = <String>{};
        for (final f in remote) {
          final appid = f is Map ? f['appid']?.toString() : null;
          if (appid != null && appid.trim().isNotEmpty)
            remoteSet.add(appid.trim());
        }

        final localSet = items.map((e) => e.appId).toSet();
        for (final item in items) {
          if (!remoteSet.contains(item.appId)) {
            await _storage.removeFromWishlist(item.appId);
            localSet.remove(item.appId);
          }
        }

        for (final f in remote) {
          if (f is! Map) continue;
          final appid = f['appid']?.toString().trim();
          if (appid == null || appid.isEmpty) continue;
          if (localSet.contains(appid)) continue;
          final name = f['name']?.toString() ?? '';
          final headerImage = f['headerImage']?.toString() ?? '';
          if (name.isEmpty) continue;
          await _storage.addToWishlist(
            WishlistItem(
              appId: appid,
              name: name,
              image: headerImage,
              targetDiscount: 0,
            ),
          );
          localSet.add(appid);
        }

        items = await _storage.getWishlistItems();
      } catch (_) {
        // 远程同步失败则回退本地 wishlist
      }
    }

    if (mounted) {
      setState(() {
        _items = items;
        _deals = deals;
        _lastDiscounts = lastDiscounts;
        _loading = false;
      });
    }
    await _loadDecisions();
  }

  Future<void> _loadDecisions() async {
    final token = await StorageService.instance.getSteamBackendToken();
    if (token == null || token.isEmpty) {
      if (mounted) setState(() => _decisionsByAppId = {});
      return;
    }
    try {
      final region = await AppCountryResolver.resolveContext();
      final data = await SteamBackendService()
          .getWishlistDecisions(token, country: region.countryCode);
      final raw = data['items'] as List<dynamic>? ?? [];
      final m = <String, Map<String, dynamic>>{};
      for (final x in raw) {
        if (x is Map) {
          final appid = x['appid']?.toString().trim() ?? '';
          if (appid.isNotEmpty) m[appid] = Map<String, dynamic>.from(x);
        }
      }
      if (mounted) setState(() => _decisionsByAppId = m);
    } catch (_) {
      if (mounted) setState(() => _decisionsByAppId = {});
    }
  }

  String _decisionLabel(String? code) {
    final l10n = AppLocalizations.of(context);
    switch (code) {
      case 'buy_now':
        return l10n.get('decision_buy_now');
      case 'wait':
        return l10n.get('decision_wait');
      case 'watch':
        return l10n.get('decision_watch');
      default:
        return code ?? '';
    }
  }

  Color _decisionColor(String? code) {
    switch (code) {
      case 'buy_now':
        return Colors.greenAccent.shade400;
      case 'wait':
        return AppColors.textSecondary;
      case 'watch':
        return AppColors.itadOrange;
      default:
        return AppColors.textSecondary;
    }
  }

  List<WishlistItem> get _filteredItems {
    if (_searchQuery.isEmpty) return _items;
    final q = _searchQuery.toLowerCase();
    return _items.where((item) => item.name.toLowerCase().contains(q)).toList();
  }

  int _decisionRank(String appId) {
    final d = _decisionsByAppId[appId]?['decision']?.toString() ?? '';
    if (d == 'buy_now') return 0;
    if (d == 'watch') return 1;
    if (d == 'wait') return 2;
    return 3;
  }

  List<WishlistItem> get _displayItems {
    final base = _filteredItems;
    if (_sortMode == 0) return base;
    final copy = List<WishlistItem>.from(base);
    if (_sortMode == 1) {
      copy.sort((a, b) {
        final ga = _gameFor(a);
        final gb = _gameFor(b);
        return (gb?.discount ?? -1).compareTo(ga?.discount ?? -1);
      });
    } else if (_sortMode == 2) {
      copy.sort((a, b) => a.name.toLowerCase().compareTo(b.name.toLowerCase()));
    } else if (_sortMode == 3) {
      copy.sort(
          (a, b) => _decisionRank(a.appId).compareTo(_decisionRank(b.appId)));
    }
    return copy;
  }

  GameModel? _gameFor(WishlistItem item) {
    try {
      return _deals.firstWhere((g) => g.appId == item.appId);
    } catch (_) {
      return null;
    }
  }

  Widget _buildListContent(ThemeData theme, List<WishlistItem> filtered) {
    if (filtered.isEmpty) {
      return Center(
        child: Text(
          _searchQuery.isEmpty
              ? ''
              : AppLocalizations.of(context).get('search_no_match'),
          style: theme.textTheme.bodyMedium,
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView.builder(
        padding: const EdgeInsets.only(top: 8, bottom: 24),
        itemCount: filtered.length,
        itemBuilder: (context, index) {
          final item = filtered[index];
          final game = _gameFor(item);
          if (game == null) {
            return Card(
              margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 6),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
              child: ListTile(
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                leading: item.image != null && item.image.isNotEmpty
                    ? ClipRRect(
                        borderRadius: BorderRadius.circular(10),
                        child: Image.network(
                          item.image,
                          width: 56,
                          height: 36,
                          fit: BoxFit.cover,
                        ),
                      )
                    : const Icon(Icons.games),
                title: Text(item.name,
                    maxLines: 2, overflow: TextOverflow.ellipsis),
                subtitle: Text(AppLocalizations.of(context).get('deal_ended'),
                    style: theme.textTheme.bodySmall),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) =>
                        GameDetailPage(game: buildStubGameForDetail(item.appId)),
                  ),
                ),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () async {
                    final token =
                        await StorageService.instance.getSteamBackendToken();
                    if (token != null && token.isNotEmpty) {
                      try {
                        await SteamBackendService()
                            .deleteFavorite(token: token, appid: item.appId);
                      } catch (_) {}
                    }
                    await _storage.removeFromWishlist(item.appId);
                    _load();
                  },
                ),
              ),
            );
          }
          final lastD = _lastDiscounts[item.appId];
          final priceDropped = lastD != null && game.discount > lastD;
          final dec = _decisionsByAppId[item.appId];
          final decCode = dec?['decision']?.toString();
          return Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            mainAxisSize: MainAxisSize.min,
            children: [
              if (dec != null && decCode != null && decCode.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(left: 16, bottom: 4),
                  child: InkWell(
                    onTap: () {
                      AnalyticsService.instance.logWishlistDecisionClick(
                        decision: decCode,
                        steamAppId: item.appId,
                      );
                    },
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 10, vertical: 5),
                      decoration: BoxDecoration(
                        color: _decisionColor(decCode).withOpacity(0.15),
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(
                            color: _decisionColor(decCode).withOpacity(0.4)),
                      ),
                      child: Text(
                        _decisionLabel(decCode),
                        style: TextStyle(
                          fontSize: 12,
                          fontWeight: FontWeight.w600,
                          color: _decisionColor(decCode),
                        ),
                      ),
                    ),
                  ),
                ),
              if (priceDropped)
                Padding(
                  padding: const EdgeInsets.only(left: 16, bottom: 4),
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(
                      color: AppColors.danger.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(10),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.trending_down,
                            size: 16, color: AppColors.danger),
                        const SizedBox(width: 4),
                        Text(AppLocalizations.of(context).get('price_dropped'),
                            style: const TextStyle(
                                fontSize: 13,
                                fontWeight: FontWeight.w600,
                                color: AppColors.danger)),
                      ],
                    ),
                  ),
                ),
              GameCard(
                game: game,
                showWishlistButton: true,
                isInWishlist: true,
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute(
                    builder: (_) => GameDetailPage(game: game),
                  ),
                ),
                onWishlistToggle: () async {
                  final token =
                      await StorageService.instance.getSteamBackendToken();
                  if (token != null && token.isNotEmpty) {
                    try {
                      await SteamBackendService()
                          .deleteFavorite(token: token, appid: item.appId);
                    } catch (_) {}
                  }
                  await _storage.removeFromWishlist(item.appId);
                  _load();
                },
              ),
            ],
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    if (!_isLoggedIn) {
      return Scaffold(
        backgroundColor: AppColors.background,
        appBar: AppBar(
          backgroundColor: AppColors.background,
          title: Text(AppLocalizations.of(context).get('wishlist_tab'),
              style: const TextStyle(color: AppColors.textPrimary)),
        ),
        body: _LoginGate(
          onSignIn: () async {
            await AuthService().signInWithGoogle();
            _checkAuthAndLoad();
          },
        ),
      );
    }
    final filtered = _displayItems;
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        backgroundColor: AppColors.background,
        title: Text(AppLocalizations.of(context).get('wishlist_tab'),
            style: const TextStyle(color: AppColors.textPrimary)),
        actions: [
          PopupMenuButton<int>(
            icon: const Icon(Icons.sort),
            tooltip: AppLocalizations.of(context).get('wishlist_sort_title'),
            initialValue: _sortMode,
            onSelected: (v) => setState(() => _sortMode = v),
            itemBuilder: (ctx) => [
              PopupMenuItem(
                  value: 0,
                  child: Text(
                      AppLocalizations.of(ctx).get('wishlist_sort_default'))),
              PopupMenuItem(
                  value: 1,
                  child: Text(
                      AppLocalizations.of(ctx).get('wishlist_sort_discount'))),
              PopupMenuItem(
                  value: 2,
                  child:
                      Text(AppLocalizations.of(ctx).get('wishlist_sort_name'))),
              PopupMenuItem(
                  value: 3,
                  child: Text(
                      AppLocalizations.of(ctx).get('wishlist_sort_decision'))),
            ],
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _items.isEmpty
              ? _EmptyWishlist(theme: theme)
              : Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: <Widget>[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 16, 16, 12),
                      child: Material(
                        color: Colors.transparent,
                        child: InkWell(
                          onTap: () {
                            Navigator.of(context).push(
                              MaterialPageRoute(
                                  builder: (_) => const SubscriptionPage(
                                      paywallSource: 'wishlist')),
                            );
                          },
                          borderRadius: BorderRadius.circular(20),
                          child: Container(
                            padding: const EdgeInsets.all(16),
                            decoration: BoxDecoration(
                              color: AppColors.primary.withOpacity(0.12),
                              borderRadius: BorderRadius.circular(20),
                              boxShadow: const [
                                BoxShadow(
                                    color: Colors.black26,
                                    blurRadius: 6,
                                    offset: Offset(0, 2))
                              ],
                            ),
                            child: Row(
                              children: [
                                const Icon(Icons.rocket_launch,
                                    color: AppColors.itadOrange, size: 28),
                                const SizedBox(width: 12),
                                Expanded(
                                  child: Text(
                                    AppLocalizations.of(context)
                                        .get('upgrade_to_pro_instant_alerts'),
                                    style: const TextStyle(
                                      fontSize: 15,
                                      fontWeight: FontWeight.w600,
                                      color: AppColors.textPrimary,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ),
                      ),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
                      child: TextField(
                        controller: _searchController,
                        decoration: InputDecoration(
                          hintText: AppLocalizations.of(context)
                              .get('wishlist_search_hint'),
                          prefixIcon: const Icon(Icons.search),
                          suffixIcon: _searchQuery.isNotEmpty
                              ? IconButton(
                                  icon: const Icon(Icons.clear),
                                  onPressed: () {
                                    _searchController.clear();
                                  },
                                )
                              : null,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                          ),
                          contentPadding: const EdgeInsets.symmetric(
                              horizontal: 16, vertical: 12),
                        ),
                        onChanged: (_) => setState(() {}),
                      ),
                    ),
                    Expanded(
                      child: _buildListContent(theme, filtered),
                    ),
                  ],
                ),
    );
  }
}

class _LoginGate extends StatelessWidget {
  final VoidCallback onSignIn;

  const _LoginGate({super.key, required this.onSignIn});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.favorite_border,
                size: 64, color: AppColors.textSecondary),
            const SizedBox(height: 24),
            Text(
              AppLocalizations.of(context).get('sign_in_to_use_wishlist'),
              style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            Text(
              AppLocalizations.of(context).get('sign_in_google_wishlist_hint'),
              style: TextStyle(fontSize: 14, color: AppColors.textSecondary),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 24),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: onSignIn,
                icon: const Icon(Icons.login),
                label: Text(AppLocalizations.of(context).get('sign_in_google')),
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 14),
                  backgroundColor: AppColors.itadOrange,
                  foregroundColor: Colors.white,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyWishlist extends StatelessWidget {
  final ThemeData theme;

  const _EmptyWishlist({super.key, required this.theme});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.favorite_border,
                size: 72, color: theme.textTheme.bodySmall!.color),
            const SizedBox(height: 24),
            Text(
              AppLocalizations.of(context).get('empty_wishlist_title'),
              style: theme.textTheme.titleLarge!,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 12),
            Text(
              AppLocalizations.of(context).get('empty_wishlist_subtitle'),
              style: theme.textTheme.bodySmall!,
              textAlign: TextAlign.center,
            ),
          ],
        ),
      ),
    );
  }
}
