import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';

import '../../core/storage_service.dart';
import '../../services/steam_backend_service.dart';
import '../../models/wishlist_model.dart';
import '../../core/theme/colors.dart';
import '../../core/app_remote_config.dart';
import '../../core/constants/api_constants.dart';

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
      _errorMessage = null;
      _ownedErrorMessage = null;
      _recentErrorMessage = null;
      _friendsErrorMessage = null;
    });

    final token = await StorageService.instance.getSteamBackendToken();
    if (token == null || token.isEmpty) {
      setState(() {
        _loading = false;
        _errorMessage = 'Steam 尚未登录，请先在 Profile 页面完成 Steam OpenID 登录/绑定。';
      });
      return;
    }

    try {
      try {
        final ownedRaw = await _backend.getOwnedGames(token);
        _ownedGames = (ownedRaw is List ? ownedRaw : [])
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
        _recentGames = (recentRaw is List ? recentRaw : [])
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
        _friends = (friendsRaw is List ? friendsRaw : [])
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
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('无法打开 Steam 登录链接，请检查网络/系统设置')),
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

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: const Text('Steam Library'),
        backgroundColor: AppColors.background,
        elevation: 0,
        actions: [
          IconButton(
            icon: const Icon(Icons.sync),
            onPressed: _syncSteam,
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
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
                          child: const Text('Continue with Steam'),
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
                        title: 'Owned Games',
                        trailing: Text('收藏：${_ownedGames.length}'),
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
                        ),
                      const SizedBox(height: 16),
                      _SectionHeader(
                        title: 'Recently Played',
                        trailing: Text('条目：${_recentGames.length}'),
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
                        ),
                      const SizedBox(height: 16),
                      _SectionHeader(
                        title: 'Friends Status',
                        trailing: Text('好友：${_friends.length}'),
                      ),
                      const SizedBox(height: 8),
                      if (_friendsErrorMessage != null)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 8),
                          child: Text(_friendsErrorMessage!, style: theme.textTheme.bodyMedium),
                        )
                      else
                        _FriendList(friends: _friends),
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

  const _GameList({required this.games, required this.onToggleFavorite});

  @override
  Widget build(BuildContext context) {
    if (games.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: Text('暂无数据'),
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

  const _FriendList({required this.friends});

  @override
  Widget build(BuildContext context) {
    if (friends.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: Text('暂无好友状态'),
      );
    }

    final items = friends.length > 30 ? friends.sublist(0, 30) : friends;
    return Column(
      children: items.map((f) {
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
              f.currentGame != null ? '${f.personaLabel} - 当前玩：${f.currentGame}' : f.personaLabel,
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
        );
      }).toList(),
    );
  }
}

