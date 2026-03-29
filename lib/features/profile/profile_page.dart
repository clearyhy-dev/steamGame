import 'dart:async';
import 'package:flutter/material.dart';
import 'package:share_plus/share_plus.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:permission_handler/permission_handler.dart' as permission_handler;
import '../../core/theme/colors.dart';
import '../../core/region_config.dart';
import '../../core/storage_service.dart';
import '../../data/services/cache_service.dart';
import '../../core/notification_service.dart';
import '../../core/services/auth_service.dart';
import '../../core/services/review_service.dart';
import '../../l10n/app_localizations.dart';
import '../subscription/subscription_page.dart';
import '../onboarding/onboarding_page.dart';
import '../../core/constants/api_constants.dart';
import '../../services/steam_backend_service.dart';
import '../../core/services/analytics_service.dart';
import '../../core/steam_auth_events.dart';
import 'package:url_launcher/url_launcher.dart' as url_launcher;
import '../steam/presentation/pages/steam_account_page.dart';

/// Profile 页：用户信息、登录/登出、Pro、分享、语言、通知等
class ProfilePage extends StatefulWidget {
  final Future<void> Function()? onLocaleChanged;

  const ProfilePage({super.key, this.onLocaleChanged});

  @override
  State<ProfilePage> createState() => _ProfilePageState();
}

class _ProfilePageState extends State<ProfilePage> {
  bool _isPro = false;
  Map<String, String>? _user;
  String? _currentLocaleCode;

  String? _steamId;
  String? _steamPersonaName;

  /// `/v1/stats/*` 聚合画像
  Map<String, dynamic>? _statsSummary;
  Map<String, dynamic>? _shareCard;

  /// Google 登录进行中（避免重复点击、并显示加载）
  bool _googleSigningIn = false;

  StreamSubscription<SteamAuthSuccessPayload>? _steamAuthSub;

  @override
  void initState() {
    super.initState();
    _load();

    _steamAuthSub = SteamAuthEvents.instance.stream.listen((payload) {
      if (!mounted) return;
      setState(() {
        _steamId = payload.steamId;
        _steamPersonaName = payload.personaName;
      });
      _load();
    });
  }

  @override
  void dispose() {
    _steamAuthSub?.cancel();
    super.dispose();
  }

  Future<void> _load() async {
    final pro = await StorageService.instance.isPro();
    final user = await AuthService().getCurrentUser();
    final localeCode = await StorageService.instance.getPreferredLocale();

    String? steamToken;
    try {
      steamToken = await StorageService.instance.getSteamBackendToken();
    } catch (_) {}

    String? steamPersonaName;
    String? steamId;
    if (steamToken != null && steamToken.isNotEmpty) {
      try {
        final backend = SteamBackendService();
        final profile = await backend.getSteamProfile(steamToken);
        steamId = profile['steamId']?.toString();
        steamPersonaName = profile['personaName']?.toString();
      } catch (_) {
        // fallback to cache
        final cached = await StorageService.instance.getSteamProfileCache();
        steamId = cached['steamId']?.toString().trim().isNotEmpty == true ? cached['steamId'] : null;
        steamPersonaName = cached['personaName']?.toString().trim().isNotEmpty == true ? cached['personaName'] : null;
      }
    } else {
      final cached = await StorageService.instance.getSteamProfileCache();
      steamId = cached['steamId']?.toString().trim().isNotEmpty == true ? cached['steamId'] : null;
      steamPersonaName = cached['personaName']?.toString().trim().isNotEmpty == true ? cached['personaName'] : null;
    }

    Map<String, dynamic>? statsSummary;
    Map<String, dynamic>? shareCardData;
    if (steamToken != null && steamToken.isNotEmpty) {
      try {
        final backend = SteamBackendService();
        statsSummary = await backend.getStatsSummary(steamToken);
        shareCardData = await backend.getShareCard(steamToken);
      } catch (_) {}
    }

    if (mounted) {
      setState(() {
        _isPro = pro;
        _user = user;
        _currentLocaleCode = localeCode;
        _steamId = steamId;
        _steamPersonaName = steamPersonaName;
        _statsSummary = statsSummary;
        _shareCard = shareCardData;
      });
    }
  }

  String _localizedShareOneLiner(AppLocalizations l10n, Map<String, dynamic> s) {
    final ratio = (s['unplayedRatio'] as num?)?.toDouble() ?? 0;
    final topList = s['topPlayed'] as List<dynamic>?;
    var topName = '';
    if (topList != null && topList.isNotEmpty) {
      final first = topList.first;
      if (first is Map) {
        topName = first['name']?.toString() ?? '';
      }
    }
    if (ratio > 0.5) return l10n.get('stats_share_note_unplayed');
    if (topName.isNotEmpty) {
      return l10n.get('stats_share_note_top').replaceAll('{name}', topName);
    }
    return l10n.get('stats_share_fallback');
  }

  String _shareCardSubtitle(AppLocalizations l10n) {
    if (_statsSummary != null && _statsSummary!['steamLinked'] == true) {
      return _localizedShareOneLiner(l10n, _statsSummary!);
    }
    if (_shareCard != null && _shareCard!['stats'] is Map) {
      return ((_shareCard!['stats'] as Map)['collectionNote']?.toString()) ?? '';
    }
    return l10n.get('stats_share_fallback');
  }

  String _shareCardFullText(AppLocalizations l10n) {
    final title = l10n.get('stats_share_app_line');
    if (_statsSummary != null && _statsSummary!['steamLinked'] == true) {
      final s = _statsSummary!;
      final n = (s['ownedCount'] as num?)?.toInt() ?? 0;
      final min = (s['totalPlaytimeMinutes'] as num?)?.toDouble() ?? 0;
      final hours = min / 60.0;
      final hStr = hours >= 100 ? '${hours.round()}' : hours.toStringAsFixed(1);
      final genres = s['favoriteGenres'] as List<dynamic>?;
      final g = (genres != null && genres.isNotEmpty) ? genres.first.toString() : '';
      final b = StringBuffer()
        ..writeln(title)
        ..writeln(l10n.get('stats_share_line_games').replaceAll('{n}', '$n'))
        ..writeln(l10n.get('stats_share_line_hours').replaceAll('{h}', hStr));
      if (g.isNotEmpty) {
        b.writeln(l10n.get('stats_share_line_genre').replaceAll('{g}', g));
      }
      b.write(_localizedShareOneLiner(l10n, s));
      return b.toString();
    }
    return '$title\n${_shareCardSubtitle(l10n)}';
  }

  bool _isRegionSelected(RegionEntry? region, String? stored) {
    if (region == null) return stored == null || stored.isEmpty;
    if (stored == null || stored.isEmpty) return false;
    if (region.id == stored) return true;
    return region.localeCode == stored && !RegionConfig.isRegionId(stored);
  }

  Future<void> _showRegionPicker() async {
    final systemLabel = AppLocalizations.of(context).get('system_default');
    final regions = [null, ...RegionConfig.allRegions];
    final selected = await showDialog<String?>(
      context: context,
      builder: (ctx) => AlertDialog(
        backgroundColor: AppColors.cardDark,
        title: Text(
          AppLocalizations.of(ctx).get('region'),
          style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600, color: AppColors.textPrimary),
        ),
        content: SizedBox(
          width: double.maxFinite,
          child: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.of(ctx).size.height * 0.6),
            child: ListView.builder(
              shrinkWrap: true,
              itemCount: regions.length,
              itemBuilder: (_, index) {
                final r = regions[index];
                final label = r == null ? systemLabel : r.displayName;
                final valueToStore = r?.id ?? '';
                final isSelected = _isRegionSelected(r, _currentLocaleCode);
                return ListTile(
                  title: Text(
                    label,
                    style: const TextStyle(color: AppColors.textPrimary, fontSize: 16),
                  ),
                  trailing: isSelected ? const Icon(Icons.check, color: AppColors.itadOrange) : null,
                  onTap: () => Navigator.pop(ctx, valueToStore),
                );
              },
            ),
          ),
        ),
      ),
    );
    if (selected == null) return;
    final toStore = selected.isEmpty ? null : selected;
    if (toStore == _currentLocaleCode || (toStore == null && (_currentLocaleCode == null || _currentLocaleCode!.isEmpty))) return;
    await StorageService.instance.setPreferredLocale(toStore);
    await StorageService.instance.clearLastDailyTaskScheduledAt();
    await StorageService.instance.clearLastWishlistTaskScheduledAt();
    await CacheService.clearLastCheckTime();
    await NotificationService.instance.rescheduleDaily();
    await widget.onLocaleChanged?.call();
    if (mounted) _load();
  }

  Future<void> _startSteamLogin({required bool bindMode}) async {
    try {
      final startPath = bindMode ? '/auth/steam/start?mode=bind' : '/auth/steam/start?mode=login';
      final start = Uri.parse('${ApiConstants.baseUrl}$startPath');

      Uri finalStart = start;
      if (bindMode) {
        final u = _user;
        if (u == null) throw Exception('Google login required for bind.');
        final token = await StorageService.instance.getSteamBackendToken();
        finalStart = start.replace(
          queryParameters: <String, String>{
            'mode': 'bind',
            if (token != null && token.isNotEmpty) 'token': token,
            'appUserId': u['userId'] ?? '',
            'appEmail': u['email'] ?? '',
            'appPhotoUrl': u['photoUrl'] ?? '',
          },
        );
      }

      // 勿依赖 canLaunchUrl：Android 11+ 无 <queries> 时常误判为 false，导致永远打不开浏览器
      final ok = await url_launcher.launchUrl(
        finalStart,
        mode: url_launcher.LaunchMode.externalApplication,
      );
      if (!ok) throw Exception('launchUrl returned false');
    } catch (e) {
      if (!mounted) return;
      final l10n = AppLocalizations.of(context);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('${l10n.get('steam_login_start_failed')}$e'),
          duration: const Duration(seconds: 5),
        ),
      );
    }
  }

  Future<void> _runGoogleSignIn() async {
    if (_googleSigningIn) return;
    final l10n = AppLocalizations.of(context);
    setState(() => _googleSigningIn = true);
    try {
      await AuthService().signInWithGoogle();
      await _load();
    } catch (_) {
      await _load();
      if (!mounted) return;
      final msg = AuthService.lastSignInError ?? l10n.get('sign_in_failed');
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(msg), duration: const Duration(seconds: 8)),
      );
    } finally {
      if (mounted) setState(() => _googleSigningIn = false);
    }
  }

  void _showLoginMethodSheet() {
    final l10n = AppLocalizations.of(context);
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: AppColors.cardDark,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(8, 12, 8, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                child: Text(
                  l10n.get('choose_sign_in_method'),
                  style: TextStyle(
                    fontSize: 18,
                    fontWeight: FontWeight.w600,
                    color: Colors.grey.shade200,
                  ),
                  textAlign: TextAlign.center,
                ),
              ),
              ListTile(
                leading: const Icon(Icons.account_circle, color: AppColors.itadOrange),
                title: Text(l10n.get('sign_in_google')),
                subtitle: Text(l10n.get('sign_in_hint')),
                onTap: () async {
                  Navigator.pop(ctx);
                  await _runGoogleSignIn();
                },
              ),
              ListTile(
                leading: const Icon(Icons.sports_esports, color: AppColors.itadOrange),
                title: Text(l10n.get('use_steam_login')),
                subtitle: Text(l10n.get('use_steam_login_sub')),
                onTap: () async {
                  Navigator.pop(ctx);
                  await _startSteamLogin(bindMode: false);
                },
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _logoutSteam() async {
    final token = await StorageService.instance.getSteamBackendToken();
    if (token == null || token.isEmpty) return;
    try {
      final backend = SteamBackendService();
      await backend.logout(token);
    } catch (_) {
      // ignore
    }
    await StorageService.instance.clearSteamBackendToken();
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(l10n.get('profile')),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 16),
          children: [
            if (_user != null) ...[
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      CircleAvatar(
                        radius: 28,
                        backgroundImage: _user!['photoUrl'] != null && _user!['photoUrl']!.isNotEmpty
                            ? CachedNetworkImageProvider(_user!['photoUrl']!)
                            : null,
                        child: _user!['photoUrl'] == null || _user!['photoUrl']!.isEmpty
                            ? const Icon(Icons.person, size: 32)
                            : null,
                      ),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _user!['email']?.isNotEmpty == true ? _user!['email']! : l10n.get('signed_in'),
                              style: const TextStyle(fontWeight: FontWeight.w600),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            const SizedBox(height: 4),
                            TextButton(
                              onPressed: () async {
                                await AuthService().signOut();
                                _load();
                              },
                              child: Text(l10n.get('sign_out')),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 16),
            ],
            if (_user == null) ...[
              if (_steamId == null || _steamId!.isEmpty)
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.login, color: AppColors.itadOrange),
                    title: Text(l10n.get('login')),
                    subtitle: Text(l10n.get('login_subtitle')),
                    trailing: _googleSigningIn
                        ? const SizedBox(
                            width: 24,
                            height: 24,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.chevron_right),
                    onTap: _googleSigningIn ? null : _showLoginMethodSheet,
                  ),
                )
              else
                Card(
                  child: ListTile(
                    leading: const Icon(Icons.sports_esports, color: AppColors.itadOrange),
                    title: Text(l10n.get('steam_linked')),
                    subtitle: Text(_steamPersonaName ?? l10n.get('steam_linked_sub')),
                    trailing: const Icon(Icons.chevron_right),
                    onTap: () {
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const SteamAccountPage()),
                      );
                    },
                  ),
                ),
              const SizedBox(height: 16),
            ],

            // 已登录 Google：Steam 绑定 / 进入 Steam 中心
            if (_user != null)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.sports_esports, color: AppColors.itadOrange),
                  title: Text(
                    _steamId == null || _steamId!.isEmpty
                        ? l10n.get('steam_continue')
                        : l10n.get('steam_linked'),
                  ),
                  subtitle: Text(
                    _steamId == null || _steamId!.isEmpty
                        ? l10n.get('steam_openid_continue')
                        : (_steamPersonaName ?? l10n.get('steam_linked_placeholder')),
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () {
                    if (_steamId != null && _steamId!.isNotEmpty) {
                      Navigator.of(context).push(
                        MaterialPageRoute(builder: (_) => const SteamAccountPage()),
                      );
                      return;
                    }
                    _startSteamLogin(bindMode: false);
                  },
                ),
              ),

            if (_user != null)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.link),
                  title: Text(l10n.get('steam_bind_google')),
                  subtitle: Text(l10n.get('steam_bind_google_sub')),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => _startSteamLogin(bindMode: true),
                ),
              ),

            if (_steamId != null && _steamId!.isNotEmpty)
              Card(
                child: ListTile(
                  leading: const Icon(Icons.logout, color: AppColors.itadOrange),
                  title: Text(l10n.get('sign_out_steam')),
                  subtitle: Text(l10n.get('sign_out_steam_sub')),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () async {
                    await _logoutSteam();
                    await _load();
                  },
                ),
              ),

            if (_statsSummary != null && _statsSummary!['steamLinked'] == true) ...[
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        l10n.get('stats_library_summary'),
                        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: 16),
                      ),
                      const SizedBox(height: 10),
                      Text(
                        l10n.get('stats_games_owned').replaceAll('{n}', '${_statsSummary!['ownedCount'] ?? 0}'),
                        style: TextStyle(fontSize: 14, color: AppColors.textSecondary),
                      ),
                      Text(
                        l10n.get('stats_unplayed_line').replaceAll(
                              '{p}',
                              '${(((_statsSummary!['unplayedRatio'] as num?)?.toDouble() ?? 0) * 100).round()}',
                            ),
                        style: TextStyle(fontSize: 14, color: AppColors.textSecondary),
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],

            if (_shareCard != null || (_statsSummary != null && _statsSummary!['steamLinked'] == true))
              Card(
                child: ListTile(
                  leading: const Icon(Icons.image_outlined, color: AppColors.itadOrange),
                  title: Text(l10n.get('stats_share_card')),
                  subtitle: Text(
                    _shareCardSubtitle(l10n),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis,
                  ),
                  trailing: const Icon(Icons.share),
                  onTap: () {
                    AnalyticsService.instance.logProfileShareClick();
                    Share.share(_shareCardFullText(l10n));
                  },
                ),
              ),

            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(vertical: 10, horizontal: 12),
              margin: const EdgeInsets.only(bottom: 16),
              decoration: BoxDecoration(
                color: AppColors.primary.withOpacity(0.12),
                borderRadius: BorderRadius.circular(10),
              ),
              child: Row(
                children: [
                  Icon(Icons.info_outline, color: AppColors.itadOrange, size: 22),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      l10n.get('profile_enabled_features'),
                      style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w500),
                    ),
                  ),
                ],
              ),
            ),
            if (_isPro)
              Card(
                color: AppColors.successGreen.withOpacity(0.15),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Row(
                    children: [
                      const Icon(Icons.workspace_premium, color: AppColors.successGreen, size: 32),
                      const SizedBox(width: 12),
                      Text(l10n.get('proFeature'), style: const TextStyle(fontWeight: FontWeight.w600)),
                    ],
                  ),
                ),
              )
            else
              Card(
                child: ListTile(
                  leading: const Icon(Icons.workspace_premium_outlined),
                  title: Text(l10n.get('subscription_title')),
                  subtitle: Text(l10n.get('unlimited_lookups')),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () async {
                    await Navigator.of(context).push(
                      MaterialPageRoute(builder: (_) => const SubscriptionPage(paywallSource: 'profile')),
                    );
                    _load();
                  },
                ),
              ),
            const SizedBox(height: 16),
            Card(
              child: ListTile(
                leading: const Icon(Icons.public),
                title: Text(l10n.get('region')),
                subtitle: Text(
                  RegionConfig.getDisplayNameForStored(_currentLocaleCode, l10n.get('system_default')),
                  style: TextStyle(fontSize: 13, color: AppColors.textSecondary),
                ),
                trailing: const Icon(Icons.chevron_right),
                onTap: _showRegionPicker,
              ),
            ),
            const SizedBox(height: 16),
            Card(
              child: ListTile(
                leading: const Icon(Icons.notifications_outlined),
                title: Text(l10n.get('notifications')),
                subtitle: Text(l10n.get('notifications_hint')),
                trailing: const Icon(Icons.chevron_right),
                onTap: () async {
                  await permission_handler.openAppSettings();
                },
              ),
            ),
            const SizedBox(height: 16),
            Card(
              child: ListTile(
                leading: const Icon(Icons.settings_suggest, color: AppColors.itadOrange),
                title: Text(l10n.get('background_run_title')),
                subtitle: Text(l10n.get('background_run_hint')),
                trailing: const Icon(Icons.chevron_right),
                onTap: () async {
                  await permission_handler.openAppSettings();
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(l10n.get('background_run_hint')),
                        duration: const Duration(seconds: 5),
                      ),
                    );
                  }
                },
              ),
            ),
            const SizedBox(height: 16),
            Card(
              child: ListTile(
                leading: const Icon(Icons.share),
                title: Text(l10n.get('share_app')),
                subtitle: Text(l10n.get('share_app_hint')),
                trailing: const Icon(Icons.chevron_right),
                onTap: () async {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(l10n.get('share_return_hint')), duration: const Duration(seconds: 4)),
                    );
                  }
                  final storage = StorageService.instance;
                  final userId = await storage.getOrCreateUserId();
                  const baseUrl = 'https://steamdeals.app/invite';
                  final link = '$baseUrl?ref=$userId';
                  final msg = '${l10n.get('share_message')}\n$link';
                  Share.share(msg);
                  await storage.incrementShareCount();
                  _load();
                },
              ),
            ),
            const SizedBox(height: 16),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 4),
              child: Text(
                l10n.get('daily_limit_hint'),
                style: TextStyle(fontSize: 12, color: AppColors.textSecondary),
              ),
            ),
            const SizedBox(height: 16),
            Card(
              child: ListTile(
                leading: const Icon(Icons.slideshow),
                title: Text(l10n.get('app_guide')),
                subtitle: Text(l10n.get('app_guide_hint')),
                trailing: const Icon(Icons.chevron_right),
                onTap: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const OnboardingPage(showOnlyForReview: true),
                    ),
                  );
                },
              ),
            ),
            const SizedBox(height: 16),
            Card(
              child: ListTile(
                leading: const Icon(Icons.star),
                title: Text(l10n.get('rate_us')),
                subtitle: Text(l10n.get('rate_us_hint')),
                trailing: const Icon(Icons.chevron_right),
                onTap: () {
                  ReviewService().requestReviewFromUser();
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
