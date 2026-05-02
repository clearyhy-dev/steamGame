import 'package:flutter/material.dart';
import '../l10n/app_localizations.dart';
import '../core/notification_permission_helper.dart';
import '../core/app_country_events.dart';
import '../core/storage_service.dart';
import '../models/game_model.dart';
import '../models/wishlist_model.dart';
import '../services/steam_api_service.dart';
import '../services/steam_backend_service.dart';
import '../core/app_country_resolver.dart';
import '../widgets/game_card.dart';
import '../features/detail/game_detail_page.dart';
import '../features/recommendation/models/recommended_item.dart';

class SearchScreen extends StatefulWidget {
  const SearchScreen({super.key});

  @override
  State<SearchScreen> createState() => _SearchScreenState();
}

class _SearchScreenState extends State<SearchScreen> {
  final SteamApiService _api = SteamApiService();
  final SteamBackendService _backend = SteamBackendService();
  final StorageService _storage = StorageService.instance;
  final TextEditingController _controller = TextEditingController();
  List<GameModel> _allGames = [];
  List<GameModel> _filtered = [];
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    AppCountryEvents.instance.changed.addListener(_onPriceRegionChanged);
    _loadDeals();
    _controller.addListener(() => setState(() {}));
  }

  void _onPriceRegionChanged() {
    _loadDeals();
  }

  Future<void> _loadDeals() async {
    final region = await AppCountryResolver.resolveContext();
    List<GameModel> list = const [];
    final token = await StorageService.instance.getSteamBackendToken();
    if (token != null && token.isNotEmpty) {
      try {
        final data = await _backend.getExploreRecommendations(
          token,
          tab: 'trending',
          country: region.countryCode,
        );
        final raw = data['items'] as List<dynamic>? ?? const [];
        list = raw
            .whereType<Map>()
            .map((e) => RecommendedItem.fromJson(
                Map<String, dynamic>.from(e)).toGameModel())
            .toList();
      } catch (_) {}
    }
    if (list.isEmpty) {
      list = await _api.fetchDeals(country: region.countryCode);
    }
    if (mounted) {
      setState(() {
        _allGames = list;
        _filtered = list;
        _loaded = true;
      });
    }
  }

  void _search(String query) {
    if (query.isEmpty) {
      setState(() {
        _filtered = _allGames;
        _loaded = true;
      });
      return;
    }
    setState(() => _loaded = false);
    _searchFromApi(query);
  }

  Future<void> _searchFromApi(String query) async {
    final region = await AppCountryResolver.resolveContext();
    final list =
        await _api.searchGames(query, pageSize: 25, country: region.countryCode);
    if (mounted) {
      setState(() {
        _filtered = list;
        _loaded = true;
      });
    }
  }

  @override
  void dispose() {
    AppCountryEvents.instance.changed.removeListener(_onPriceRegionChanged);
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(
        title: Text(AppLocalizations.of(context).get('search_title')),
      ),
      body: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            child: TextField(
              controller: _controller,
              decoration: InputDecoration(
                hintText: AppLocalizations.of(context).get('search_hint'),
                prefixIcon: const Icon(Icons.search),
                suffixIcon: _controller.text.isNotEmpty
                    ? IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _controller.clear();
                          _search('');
                        },
                      )
                    : null,
                border: OutlineInputBorder(
                  borderRadius: BorderRadius.circular(12),
                ),
                contentPadding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
              ),
              onChanged: _search,
            ),
          ),
          Expanded(
            child: !_loaded
                ? const Center(child: CircularProgressIndicator())
                : _filtered.isEmpty
                    ? Center(
                        child: Text(
                          AppLocalizations.of(context).get('no_results'),
                          style: theme.textTheme.bodyLarge,
                        ),
                      )
                    : ListView.builder(
                        itemCount: _filtered.length,
                        itemBuilder: (context, index) {
                          final game = _filtered[index];
                          return FutureBuilder<bool>(
                            future: _storage.isInWishlist(game.appId),
                            builder: (ctx, ws) => GameCard(
                              game: game,
                              isInWishlist: ws.data ?? false,
                              onTap: () => Navigator.of(context).push(
                                MaterialPageRoute(
                                  builder: (_) => GameDetailPage(game: game),
                                ),
                              ),
                              onWishlistToggle: () async {
                                final inList =
                                    await _storage.isInWishlist(game.appId);
                                if (inList) {
                                  await _storage.removeFromWishlist(game.appId);
                                } else {
                                  await _storage.addToWishlist(
                                      WishlistItem.fromGame(game));
                                  await NotificationPermissionHelper
                                      .maybeRequestWithRationale(context);
                                }
                                setState(() {});
                              },
                            ),
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }
}
