import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:url_launcher/url_launcher.dart' as url_launcher;

import '../../../../core/storage_service.dart';
import '../../../../core/theme/colors.dart';
import '../../../../l10n/app_localizations.dart';
import '../../../../services/steam_backend_service.dart';
import 'steam_account_page.dart';
import 'steam_favorites_page.dart';
import 'steam_friends_page.dart';
import 'steam_owned_games_page.dart';
import 'steam_recent_games_page.dart';

const String _kSteamNotSignedIn = '__STEAM_NOT_SIGNED_IN__';

String _steamHoursLabel(AppLocalizations l10n, int totalMinutes) {
  if (totalMinutes <= 0) return l10n.get('steam_hours_zero');
  final h = totalMinutes / 60.0;
  final v = h >= 100 ? h.round().toString() : h.toStringAsFixed(1);
  return l10n.get('steam_hours_value').replaceAll('{v}', v);
}

String _steamGamePlaytimeLine(AppLocalizations l10n, dynamic playtimeForever) {
  if (playtimeForever == null) return '';
  final m = playtimeForever is num ? playtimeForever.round() : int.tryParse(playtimeForever.toString()) ?? 0;
  if (m <= 0) return l10n.get('steam_never_played_suffix');
  final h = m / 60.0;
  final hs = h >= 10 ? h.round().toString() : h.toStringAsFixed(1);
  return ' · ${l10n.get('steam_hours_value').replaceAll('{v}', hs)}';
}

class SteamOverviewPage extends StatefulWidget {
  const SteamOverviewPage({super.key});

  @override
  State<SteamOverviewPage> createState() => _SteamOverviewPageState();
}

class _SteamOverviewPageState extends State<SteamOverviewPage> {
  final SteamBackendService _backend = SteamBackendService();

  bool _loading = true;
  String? _error;
  Map<String, dynamic>? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final token = await StorageService.instance.getSteamBackendToken();
    if (token == null || token.isEmpty) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = _kSteamNotSignedIn;
        });
      }
      return;
    }
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final d = await _backend.getSteamOverview(token);
      if (mounted) {
        setState(() {
          _data = d;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e is SteamBackendException ? e.message : e.toString();
          _loading = false;
        });
      }
    }
  }

  Future<void> _sync(AppLocalizations l10n) async {
    final token = await StorageService.instance.getSteamBackendToken();
    if (token == null || token.isEmpty) return;
    try {
      await _backend.syncSteam(token);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(l10n.get('steam_sync_requested'))),
        );
      }
      await _load();
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              '${l10n.get('steam_sync_failed_prefix')}${e is SteamBackendException ? e.message : e}',
            ),
          ),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final l10n = AppLocalizations.of(context);

    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(l10n.get('steam_overview_title')),
        backgroundColor: AppColors.background,
        actions: [
          IconButton(
            icon: const Icon(Icons.sync),
            tooltip: l10n.get('steam_sync_tooltip'),
            onPressed: _loading ? null : () => _sync(l10n),
          ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          _error == _kSteamNotSignedIn ? l10n.get('steam_not_signed_in') : _error!,
                          textAlign: TextAlign.center,
                        ),
                        const SizedBox(height: 16),
                        ElevatedButton(
                          onPressed: _load,
                          child: Text(l10n.get('retry')),
                        ),
                      ],
                    ),
                  ),
                )
              : RefreshIndicator(
                  onRefresh: _load,
                  child: _data == null
                      ? Center(child: Text(l10n.get('steam_no_data')))
                      : ListView(
                          padding: const EdgeInsets.all(16),
                          children: [
                            ..._buildProfileSection(theme, l10n),
                            const SizedBox(height: 16),
                            ..._buildStatsSection(theme, l10n),
                            const SizedBox(height: 16),
                            ..._buildErrorsSection(theme, l10n),
                            const SizedBox(height: 8),
                            ..._buildFavoritesSection(theme, l10n),
                            const SizedBox(height: 16),
                            ..._buildFriendsSection(theme, l10n),
                            const SizedBox(height: 16),
                            ..._buildOwnedSection(theme, l10n),
                            const SizedBox(height: 16),
                            ..._buildRecentSection(theme, l10n),
                            const SizedBox(height: 24),
                            _fullListLinks(theme, l10n),
                          ],
                        ),
                ),
    );
  }

  List<Widget> _buildProfileSection(ThemeData theme, AppLocalizations l10n) {
    final d = _data!;
    final p = d['profile'] as Map<String, dynamic>?;
    final ext = d['extended'] as Map<String, dynamic>?;

    if (p == null) {
      return [
        Card(
          child: ListTile(
            title: Text(l10n.get('steam_profile_card')),
            subtitle: Text(d['profileError']?.toString() ?? l10n.get('unavailable')),
          ),
        ),
      ];
    }

    final name = p['personaName']?.toString() ?? '';
    final avatar = p['avatar']?.toString() ?? '';
    final url = p['profileUrl']?.toString() ?? '';

    return [
      Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  CircleAvatar(
                    radius: 32,
                    backgroundImage: avatar.isNotEmpty ? CachedNetworkImageProvider(avatar) : null,
                    child: avatar.isEmpty ? const Icon(Icons.person, size: 36) : null,
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(name, style: theme.textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600)),
                      ],
                    ),
                  ),
                ],
              ),
              if (ext != null) ...[
                const SizedBox(height: 12),
                if ((ext['realName']?.toString() ?? '').trim().isNotEmpty)
                  Text('${l10n.get('steam_real_name')}${ext['realName']}', style: TextStyle(color: AppColors.textSecondary)),
                if ((ext['countryCode']?.toString() ?? '').trim().isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text('${l10n.get('steam_region')}${ext['countryCode']}', style: TextStyle(color: AppColors.textSecondary)),
                  ),
                if (ext['timeCreated'] != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      '${l10n.get('steam_registered')}${_formatSteamCreated(l10n, ext['timeCreated'])}',
                      style: TextStyle(color: AppColors.textSecondary),
                    ),
                  ),
              ],
              if (url.isNotEmpty) ...[
                const SizedBox(height: 12),
                TextButton.icon(
                  onPressed: () async {
                    await url_launcher.launchUrl(Uri.parse(url), mode: url_launcher.LaunchMode.externalApplication);
                  },
                  icon: const Icon(Icons.open_in_new, size: 18),
                  label: Text(l10n.get('steam_open_profile')),
                ),
              ],
            ],
          ),
        ),
      ),
    ];
  }

  String _formatSteamCreated(AppLocalizations l10n, dynamic v) {
    final n = v is num ? v.toInt() : int.tryParse(v.toString());
    if (n == null || n <= 0) return l10n.get('steam_dash');
    final dt = DateTime.fromMillisecondsSinceEpoch(n * 1000, isUtc: true).toLocal();
    return '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')}';
  }

  List<Widget> _buildStatsSection(ThemeData theme, AppLocalizations l10n) {
    final d = _data!;
    final owned = d['owned'] as Map<String, dynamic>?;
    final recent = d['recent'] as Map<String, dynamic>?;
    final friends = d['friends'] as List<dynamic>?;
    final favs = d['favorites'] as List<dynamic>?;

    final totalMin = owned != null ? (owned['totalPlaytimeMinutes'] as num?)?.round() ?? 0 : 0;
    final gameCount = owned != null ? (owned['gameCount'] as num?)?.round() ?? 0 : 0;
    final recentCount = recent != null ? (recent['totalCount'] as num?)?.round() ?? 0 : 0;

    final dash = l10n.get('steam_dash');
    return [
      Text(l10n.get('steam_section_overview'), style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
      const SizedBox(height: 8),
      Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
          child: Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              _chip(l10n, l10n.get('steam_stat_total_time'), owned != null ? _steamHoursLabel(l10n, totalMin) : dash),
              _chip(
                l10n,
                l10n.get('steam_stat_library'),
                owned != null ? '$gameCount${l10n.get('steam_suffix_games')}' : dash,
              ),
              _chip(
                l10n,
                l10n.get('steam_stat_recent'),
                recent != null ? '$recentCount${l10n.get('steam_suffix_games')}' : dash,
              ),
              _chip(
                l10n,
                l10n.get('steam_stat_friends'),
                friends != null ? '${friends.length}${l10n.get('steam_suffix_people')}' : dash,
              ),
              _chip(
                l10n,
                l10n.get('steam_stat_favorites'),
                favs != null ? '${favs.length}${l10n.get('steam_suffix_games')}' : dash,
              ),
            ],
          ),
        ),
      ),
    ];
  }

  Widget _chip(AppLocalizations l10n, String label, String value) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.cardDark,
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: Colors.white12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label, style: TextStyle(fontSize: 11, color: AppColors.textSecondary)),
          const SizedBox(height: 2),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14)),
        ],
      ),
    );
  }

  String _shortErr(AppLocalizations l10n, String? raw) {
    if (raw == null || raw.trim().isEmpty) return '';
    var s = raw.trim();
    if (s.contains('FAILED_PRECONDITION') && s.contains('index')) {
      return l10n.get('steam_err_unavailable');
    }
    if (s.contains('console.firebase.google.com') || s.length > 120) {
      final cut = s.length < 80 ? s.length : 80;
      return '${s.substring(0, cut)}…';
    }
    return s.length > 100 ? '${s.substring(0, 100)}…' : s;
  }

  List<Widget> _buildErrorsSection(ThemeData theme, AppLocalizations l10n) {
    final d = _data!;
    final rows = <String>[];
    void add(String? err, String labelKey) {
      final short = _shortErr(l10n, err?.toString());
      if (short.isNotEmpty) rows.add('${l10n.get(labelKey)}: $short');
    }

    add(d['ownedError']?.toString(), 'steam_err_owned');
    add(d['recentError']?.toString(), 'steam_err_recent');
    add(d['friendsError']?.toString(), 'steam_err_friends');
    add(d['favoritesError']?.toString(), 'steam_err_favorites');
    add(d['extendedError']?.toString(), 'steam_err_extended');

    if (rows.isEmpty) return [];

    return [
      Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                l10n.get('steam_partial_load_hint'),
                style: TextStyle(fontSize: 13, fontWeight: FontWeight.w500, color: AppColors.textSecondary),
              ),
              const SizedBox(height: 6),
              ...rows.map((t) => Padding(
                    padding: const EdgeInsets.only(bottom: 2),
                    child: Text(t, style: TextStyle(fontSize: 12, color: AppColors.textSecondary.withOpacity(0.9))),
                  )),
            ],
          ),
        ),
      ),
    ];
  }

  List<Widget> _buildFavoritesSection(ThemeData theme, AppLocalizations l10n) {
    final d = _data!;
    final list = d['favorites'] as List<dynamic>?;
    if (list == null && d['favoritesError'] != null) return [];

    final items = list ?? [];
    final show = items.length > 40 ? items.sublist(0, 40) : items;

    return [
      Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(l10n.get('steam_app_favorites_title'), style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
          TextButton(
            onPressed: () {
              Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SteamFavoritesPage()));
            },
            child: Text(l10n.get('steam_full_list')),
          ),
        ],
      ),
      if (items.isEmpty)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Text(l10n.get('steam_no_favorites_yet'), style: TextStyle(color: AppColors.textSecondary)),
          ),
        )
      else
        Card(
          child: Column(
            children: [
              for (final raw in show)
                if (raw is Map)
                  ListTile(
                    dense: true,
                    leading: (raw['headerImage']?.toString() ?? '').isNotEmpty
                        ? ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: CachedNetworkImage(
                              imageUrl: raw['headerImage'].toString(),
                              width: 46,
                              height: 27,
                              fit: BoxFit.cover,
                            ),
                          )
                        : const Icon(Icons.games_outlined),
                    title: Text(raw['name']?.toString() ?? '', maxLines: 1, overflow: TextOverflow.ellipsis),
                    subtitle: Text('${raw['appid']} · ${raw['source'] ?? ''}', style: const TextStyle(fontSize: 12)),
                  ),
              if (items.length > 40)
                Padding(
                  padding: const EdgeInsets.all(8),
                  child: Text(
                    l10n.get('steam_favorites_showing').replaceAll('{n}', '${items.length}'),
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                  ),
                ),
            ],
          ),
        ),
    ];
  }

  List<Widget> _buildFriendsSection(ThemeData theme, AppLocalizations l10n) {
    final d = _data!;
    final list = d['friends'] as List<dynamic>?;
    if (list == null && d['friendsError'] != null) return [];

    final items = list ?? [];
    final show = items.length > 30 ? items.sublist(0, 30) : items;

    return [
      Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(l10n.get('steam_friends_title'), style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
          TextButton(
            onPressed: () {
              Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SteamFriendsPage()));
            },
            child: Text(l10n.get('steam_full_list')),
          ),
        ],
      ),
      if (items.isEmpty)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Text(l10n.get('steam_no_friends_visible'), style: TextStyle(color: AppColors.textSecondary)),
          ),
        )
      else
        Card(
          child: Column(
            children: [
              for (final raw in show)
                if (raw is Map)
                  ListTile(
                    dense: true,
                    leading: CircleAvatar(
                      radius: 18,
                      backgroundImage: (raw['avatar']?.toString() ?? '').isNotEmpty
                          ? CachedNetworkImageProvider(raw['avatar'].toString())
                          : null,
                      child: (raw['avatar']?.toString() ?? '').isEmpty ? const Icon(Icons.person, size: 18) : null,
                    ),
                    title: Text(raw['personaName']?.toString() ?? '', maxLines: 1, overflow: TextOverflow.ellipsis),
                    subtitle: Text(
                      '${raw['personaLabel'] ?? ''}${(raw['gameExtrainfo']?.toString() ?? '').trim().isNotEmpty ? ' · ${raw['gameExtrainfo']}' : ''}',
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontSize: 12),
                    ),
                  ),
              if (items.length > 30)
                Padding(
                  padding: const EdgeInsets.all(8),
                  child: Text(
                    l10n.get('steam_friends_showing').replaceAll('{n}', '${items.length}'),
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                  ),
                ),
            ],
          ),
        ),
    ];
  }

  List<Widget> _buildOwnedSection(ThemeData theme, AppLocalizations l10n) {
    final d = _data!;
    final owned = d['owned'] as Map<String, dynamic>?;
    if (owned == null && d['ownedError'] != null) return [];

    final games = (owned?['games'] as List<dynamic>?) ?? [];
    final sorted = <Map<String, dynamic>>[];
    for (final x in games) {
      if (x is Map) sorted.add(Map<String, dynamic>.from(x));
    }
    sorted.sort((a, b) {
      final pa = a['playtimeForever'];
      final pb = b['playtimeForever'];
      final na = pa is num ? pa.round() : int.tryParse(pa?.toString() ?? '0') ?? 0;
      final nb = pb is num ? pb.round() : int.tryParse(pb?.toString() ?? '0') ?? 0;
      return nb.compareTo(na);
    });
    final show = sorted.length > 50 ? sorted.sublist(0, 50) : sorted;

    return [
      Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(l10n.get('steam_owned_by_time'), style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
          TextButton(
            onPressed: () {
              Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SteamOwnedGamesPage()));
            },
            child: Text(l10n.get('steam_full_list')),
          ),
        ],
      ),
      if (games.isEmpty)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Text(l10n.get('steam_no_owned_visible'), style: TextStyle(color: AppColors.textSecondary)),
          ),
        )
      else
        Card(
          child: Column(
            children: [
              for (final g in show)
                ListTile(
                  dense: true,
                  leading: (g['headerImage']?.toString() ?? '').isNotEmpty
                      ? ClipRRect(
                          borderRadius: BorderRadius.circular(4),
                          child: CachedNetworkImage(
                            imageUrl: g['headerImage'].toString(),
                            width: 46,
                            height: 27,
                            fit: BoxFit.cover,
                          ),
                        )
                      : const Icon(Icons.sports_esports_outlined),
                  title: Text(g['name']?.toString() ?? '', maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: Text(
                    '${g['appid']}${_steamGamePlaytimeLine(l10n, g['playtimeForever'])}',
                    style: const TextStyle(fontSize: 12),
                  ),
                ),
              if (sorted.length > 50)
                Padding(
                  padding: const EdgeInsets.all(8),
                  child: Text(
                    l10n.get('steam_owned_showing').replaceAll('{n}', '${games.length}'),
                    style: TextStyle(color: AppColors.textSecondary, fontSize: 12),
                  ),
                ),
            ],
          ),
        ),
    ];
  }

  List<Widget> _buildRecentSection(ThemeData theme, AppLocalizations l10n) {
    final d = _data!;
    final recent = d['recent'] as Map<String, dynamic>?;
    if (recent == null && d['recentError'] != null) return [];

    final games = (recent?['games'] as List<dynamic>?) ?? [];
    return [
      Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(l10n.get('steam_recent_title'), style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w600)),
          TextButton(
            onPressed: () {
              Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SteamRecentGamesPage()));
            },
            child: Text(l10n.get('steam_full_list')),
          ),
        ],
      ),
      if (games.isEmpty)
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Text(l10n.get('steam_no_recent_visible'), style: TextStyle(color: AppColors.textSecondary)),
          ),
        )
      else
        Card(
          child: Column(
            children: [
              for (final raw in games)
                if (raw is Map)
                  ListTile(
                    dense: true,
                    leading: (raw['headerImage']?.toString() ?? '').isNotEmpty
                        ? ClipRRect(
                            borderRadius: BorderRadius.circular(4),
                            child: CachedNetworkImage(
                              imageUrl: raw['headerImage'].toString(),
                              width: 46,
                              height: 27,
                              fit: BoxFit.cover,
                            ),
                          )
                        : const Icon(Icons.history),
                    title: Text(raw['name']?.toString() ?? '', maxLines: 1, overflow: TextOverflow.ellipsis),
                    subtitle: Text(raw['appid']?.toString() ?? '', style: const TextStyle(fontSize: 12)),
                  ),
            ],
          ),
        ),
    ];
  }

  Widget _fullListLinks(ThemeData theme, AppLocalizations l10n) {
    return Card(
      child: Column(
        children: [
          ListTile(
            leading: const Icon(Icons.account_circle_outlined, color: AppColors.itadOrange),
            title: Text(l10n.get('steam_account_center')),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SteamAccountPage()));
            },
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.people_outline),
            title: Text(l10n.get('steam_link_friends')),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SteamFriendsPage()));
            },
          ),
          ListTile(
            leading: const Icon(Icons.library_books_outlined),
            title: Text(l10n.get('steam_link_owned')),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SteamOwnedGamesPage()));
            },
          ),
          ListTile(
            leading: const Icon(Icons.history),
            title: Text(l10n.get('steam_link_recent')),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SteamRecentGamesPage()));
            },
          ),
          ListTile(
            leading: const Icon(Icons.favorite_outline),
            title: Text(l10n.get('steam_link_favorites')),
            trailing: const Icon(Icons.chevron_right),
            onTap: () {
              Navigator.of(context).push(MaterialPageRoute(builder: (_) => const SteamFavoritesPage()));
            },
          ),
        ],
      ),
    );
  }
}
