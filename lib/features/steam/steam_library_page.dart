import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';

import '../../core/storage_service.dart';
import '../../services/steam_backend_service.dart';
import '../../models/wishlist_model.dart';
import '../../core/theme/colors.dart';
import '../../core/app_remote_config.dart';
import '../../core/constants/api_constants.dart';
import '../../l10n/app_localizations.dart';

import 'package:url_launcher/url_launcher.dart' as url_launcher;

class SteamGameItem {
  final String appid;
  final String name;
  final String headerImage;
  final String source; // owned/recent

  const SteamGameItem({
    required this.appid,
    required this.name,
    required this.headerImage,
    required this.source,
  });

  factory SteamGameItem.fromBackendMap(Map<String, dynamic> m, {required String source}) {
    return SteamGameItem(
      appid: m['appid']?.toString() ?? '',
      name: m['name']?.toString() ?? '',
      headerImage: m['headerImage']?.toString() ?? '',
      source: source,
    );
  }
}

class SteamFriendRow {
  final String steamId;
  final String personaName;
  final String avatar;
  final String personaLabel;
  final String? currentGame;

  const SteamFriendRow({
    required this.steamId,
    required this.personaName,
    required this.avatar,
    required this.personaLabel,
    this.currentGame,
  });

  factory SteamFriendRow.fromBackendMap(Map<String, dynamic> m) {
    final game = (m['gameExtrainfo']?.toString() ?? '').trim();
    return SteamFriendRow(
      steamId: m['steamId']?.toString() ?? '',
      personaName: m['personaName']?.toString() ?? '',
      avatar: m['avatar']?.toString() ?? '',
      personaLabel: m['personaLabel']?.toString() ?? '',
      currentGame: game.isNotEmpty ? game : null,
    );
  }
}

class SteamLibraryPage extends StatefulWidget {
  const SteamLibraryPage({super.key});

  @override
  State<SteamLibraryPage> createState() => _SteamLibraryPageState();
}

class _SteamLibraryPageState extends State<SteamLibraryPage> {
  final SteamBackendService _backend = SteamBackendService();

  bool _loading = true;
  bool _notSignedIn = false;
  String? _errorMessage;
  String? _ownedErrorMessage;
  String? _recentErrorMessage;
  String? _friendsErrorMessage;

  List<SteamGameItem> _ownedGames = [];
  List<SteamGameItem> _recentGames = [];
  List<SteamFriendRow> _friends = [];

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _notSignedIn = false;
      _errorMessage = null;
      _ownedErrorMessage = null;
      _recentErrorMessage = null;
      _friendsErrorMessage = null;
    });

    final token = await StorageService.instance.getSteamBackendToken();
    if (token == null || token.isEmpty) {
      setState(() {
        _loading = false;
        _notSignedIn = true;
      });
      return;
    }

    try {
      try {
        final ownedRaw = await _backend.getOwnedGames(token);
        _ownedGames = ownedRaw
            .whereType<Map>()
            .map((m) => SteamGameItem.fromBackendMap(m.cast<String, dynamic>(), source: 'owned'))
            .where((g) => g.appid.isNotEmpty && g.name.isNotEmpty)
            .toList();
      } catch (e) {
        _ownedErrorMessage = e is SteamBackendException ? e.message : e.toString();
        _ownedGames = [];
      }

      try {
        final recentRaw = await _backend.getRecentGames(token);
        _recentGames = recentRaw
            .whereType<Map>()
            .map((m) => SteamGameItem.fromBackendMap(m.cast<String, dynamic>(), source: 'recent'))
            .where((g) => g.appid.isNotEmpty && g.name.isNotEmpty)
            .toList();
      } catch (e) {
        _recentErrorMessage = e is SteamBackendException ? e.message : e.toString();
        _recentGames = [];
      }

      try {
        final friendsRaw = await _backend.getFriendsStatus(token);
        _friends = friendsRaw
            .whereType<Map>()
            .map((m) => SteamFriendRow.fromBackendMap(m.cast<String, dynamic>()))
            .where((f) => f.steamId.isNotEmpty)
            .toList();
      } catch (e) {
        _friendsErrorMessage = e is SteamBackendException ? e.message : e.toString();
        _friends = [];
      }

      setState(() {
        _loading = false;
        _errorMessage = null;
      });
    } catch (e) {
      final msg = e is SteamBackendException ? e.message : e.toString();
      setState(() {
        _loading = false;
        _errorMessage = msg;
      });
    }
  }

  Future<void> _toggleFavorite(SteamGameItem game) async {
    final token = await StorageService.instance.getSteamBackendToken();
    if (token == null || token.isEmpty) return;

    final inWishlist = await StorageService.instance.isInWishlist(game.appid);

    try {
      if (inWishlist) {
        await _backend.deleteFavorite(token: token, appid: game.appid);
      } else {
        await _backend.addFavorite(
          token: token,
          appid: game.appid,
          name: game.name,
          headerImage: game.headerImage,
          source: game.source,
        );
      }
    } catch (_) {
      // 后端失败时：直接走本地兜底，让用户不被卡住
    }

    if (inWishlist) {
      await StorageService.instance.removeFromWishlist(game.appid);
    } else {
      await StorageService.instance.addToWishlist(
        WishlistItem(appId: game.appid, name: game.name, image: game.headerImage, targetDiscount: 0),
      );
    }

    await _load();
  }

  Future<void> _syncSteam() async {
    final token = await StorageService.instance.getSteamBackendToken();
    if (token == null || token.isEmpty) return;

    try {
      setState(() => _loading = true);
      await _backend.syncSteam(token);
      await _load();
    } catch (e) {
      setState(() {
        _loading = false;
        _errorMessage = e is SteamBackendException ? e.message : e.toString();
      });
    }
  }

  Future<void> _openSteamLoginStart() async {
    // 这里跳转到后端，由后端发起 Steam OpenID。
    // 后续可复用 ProfilePage 的入口，这里提供最小可用兜底。
    final apiRoot = AppRemoteConfig.instance.resolveApiBase(ApiConstants.baseUrl);
    final start = Uri.parse('$apiRoot/auth/steam/start?mode=login');
    final withTs = start.replace(queryParameters: {
      ...start.queryParameters,
      'ts': DateTime.now().millisecondsSinceEpoch.toString(),
    });
    var ok = await url_launcher.launchUrl(
      withTs,
      mode: url_launcher.LaunchMode.externalApplication,
    );
    if (!ok) {
      ok = await url_launcher.launchUrl(
        withTs,
        mode: url_launcher.LaunchMode.platformDefault,
      );
    }
    if (!ok && mounted) {
      final l10n = AppLocalizations.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(l10n.get('steam_login_open_failed'))),
      );
    }
  }

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(l10n.get('steam_library_page_title')),
        backgroundColor: AppColors.background,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.sync),
            tooltip: l10n.get('steam_sync_tooltip'),
            onPressed: _syncSteam,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _notSignedIn
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(16),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          l10n.get('steam_library_not_signed_in_detail'),
                          textAlign: TextAlign.center,
                          style: theme.textTheme.titleMedium,
                        ),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: _openSteamLoginStart,
                          child: Text(l10n.get('steam_continue')),
                        ),
                      ],
                    ),
                  ),
                )
              : _errorMessage != null
                  ? Center(
                      child: Padding(
                        padding: const EdgeInsets.all(16),
                        child: Column(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Text(_errorMessage!, style: theme.textTheme.titleMedium),
                            const SizedBox(height: 16),
                            ElevatedButton(
                              onPressed: _openSteamLoginStart,
                              child: Text(l10n.get('steam_continue')),
                            ),
                          ],
                        ),
                      ),
                    )
                  : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
                    children: [
                      _SectionHeader(
                        title: l10n.get('steam_menu_owned'),
                        trailing: Text(
                          '${_ownedGames.length}${l10n.get('steam_suffix_games')}',
                        ),
                      ),
                      const SizedBox(height: 8),
                      if (_ownedErrorMessage != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Text(_ownedErrorMessage!, style: theme.textTheme.bodyMedium),
                        )
                      else
                        _GameList(
                          games: _ownedGames,
                          onToggleFavorite: _toggleFavorite,
                          emptyLabel: l10n.get('steam_no_data'),
                        ),
                      const SizedBox(height: 16),
                      _SectionHeader(
                        title: l10n.get('steam_menu_recent'),
                        trailing: Text(
                          '${_recentGames.length}${l10n.get('steam_suffix_games')}',
                        ),
                      ),
                      const SizedBox(height: 8),
                      if (_recentErrorMessage != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Text(_recentErrorMessage!, style: theme.textTheme.bodyMedium),
                        )
                      else
                        _GameList(
                          games: _recentGames,
                          onToggleFavorite: _toggleFavorite,
                          emptyLabel: l10n.get('steam_no_data'),
                        ),
                      const SizedBox(height: 16),
                      _SectionHeader(
                        title: l10n.get('steam_menu_friends'),
                        trailing: Text(
                          '${_friends.length}${l10n.get('steam_suffix_people')}',
                        ),
                      ),
                      const SizedBox(height: 8),
                      if (_friendsErrorMessage != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Text(_friendsErrorMessage!, style: theme.textTheme.bodyMedium),
                        )
                      else
                        _FriendList(
                          friends: _friends,
                          emptyLabel: l10n.get('steam_no_friends_visible'),
                          inGameLine: (status, game) => l10n
                              .get('steam_friend_status_in_game')
                              .replaceAll('{status}', status)
                              .replaceAll('{game}', game),
                        ),
                      const SizedBox(height: 24),
                    ],
                  ),
                ),
    );
  }
}

class _SectionHeader extends StatelessWidget {
  final String title;
  final Widget? trailing;

  const _SectionHeader({required this.title, this.trailing});

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Text(
            title,
            style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w700),
          ),
        ),
        if (trailing != null) trailing!,
      ],
    );
  }
}

class _GameList extends StatelessWidget {
  final List<SteamGameItem> games;
  final Future<void> Function(SteamGameItem game) onToggleFavorite;
  final String emptyLabel;

  const _GameList({
    required this.games,
    required this.onToggleFavorite,
    required this.emptyLabel,
  });

  @override
  Widget build(BuildContext context) {
    if (games.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Text(emptyLabel),
      );
    }

    return SizedBox(
      height: 280,
      child: ListView.builder(
        itemCount: games.length,
        scrollDirection: Axis.horizontal,
        itemBuilder: (ctx, idx) {
          final g = games[idx];
          return Container(
            width: 170,
            margin: const EdgeInsets.only(right: 12, bottom: 8),
            child: Card(
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    ClipRRect(
                      borderRadius: BorderRadius.circular(12),
                      child: g.headerImage.isNotEmpty
                          ? CachedNetworkImage(
                              imageUrl: g.headerImage,
                              width: 150,
                              height: 90,
                              fit: BoxFit.cover,
                              placeholder: (_, __) => const ColoredBox(color: AppColors.card),
                              errorWidget: (_, __, ___) => const ColoredBox(color: AppColors.card),
                            )
                          : const ColoredBox(
                              color: AppColors.card,
                              child: SizedBox(width: 150, height: 90),
                            ),
                    ),
                    const SizedBox(height: 8),
                    Text(
                      g.name,
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
                    ),
                    const Spacer(),
                    Align(
                      alignment: Alignment.centerRight,
                      child: IconButton(
                        icon: const Icon(Icons.favorite_border),
                        onPressed: () => onToggleFavorite(g),
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
}

class _FriendList extends StatelessWidget {
  final List<SteamFriendRow> friends;
  final String emptyLabel;
  final String Function(String status, String game) inGameLine;

  const _FriendList({
    required this.friends,
    required this.emptyLabel,
    required this.inGameLine,
  });

  @override
  Widget build(BuildContext context) {
    if (friends.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 12),
        child: Text(emptyLabel),
      );
    }

    final items = friends.length > 30 ? friends.sublist(0, 30) : friends;
    return Column(
      children: items.map((f) {
        final subtitle = f.currentGame != null
            ? inGameLine(f.personaLabel, f.currentGame!)
            : f.personaLabel;
        return Card(
          margin: const EdgeInsets.only(bottom: 10),
          child: ListTile(
            leading: ClipRRect(
              borderRadius: BorderRadius.circular(999),
              child: f.avatar.isNotEmpty
                  ? CachedNetworkImage(
                      imageUrl: f.avatar,
                      width: 44,
                      height: 44,
                      fit: BoxFit.cover,
                      placeholder: (_, __) => const ColoredBox(color: AppColors.card),
                      errorWidget: (_, __, ___) => const ColoredBox(color: AppColors.card),
                    )
                  : const ColoredBox(color: AppColors.card, child: SizedBox(width: 44, height: 44)),
            ),
            title: Text(f.personaName, maxLines: 1, overflow: TextOverflow.ellipsis),
            subtitle: Text(
              subtitle,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        );
      }).toList(),
    );
  }
}

