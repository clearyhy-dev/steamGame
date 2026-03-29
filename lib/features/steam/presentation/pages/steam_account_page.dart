import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart' as url_launcher;
import '../../../../core/theme/colors.dart';
import '../../../../l10n/app_localizations.dart';
import '../providers/steam_providers.dart';
import 'steam_favorites_page.dart';
import 'steam_friends_page.dart';
import 'steam_owned_games_page.dart';
import 'steam_recent_games_page.dart';

class SteamAccountPage extends StatefulWidget {
  const SteamAccountPage({super.key});

  @override
  State<SteamAccountPage> createState() => _SteamAccountPageState();
}

class _SteamAccountPageState extends State<SteamAccountPage> {
  @override
  void initState() {
    super.initState();
    SteamProviderActions.instance.loadProfile();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: Text(l10n.get('steam_account_center'))),
      body: ValueListenableBuilder(
        valueListenable: steamProfileProvider,
        builder: (_, state, __) {
          if (state.loading) return const Center(child: CircularProgressIndicator());
          if (state.error != null) {
            final txt = state.error!.contains('STEAM_NOT_BOUND')
                ? l10n.get('steam_account_not_linked')
                : state.error!;
            return _ErrorRetry(message: txt, onRetry: () => SteamProviderActions.instance.loadProfile());
          }
          final p = state.data;
          if (p == null) return Center(child: Text(l10n.get('steam_account_not_linked')));
          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          ClipOval(
                            child: p.avatar.isNotEmpty
                                ? CachedNetworkImage(
                                    key: ValueKey<String>(p.avatar),
                                    imageUrl: p.avatar,
                                    width: 56,
                                    height: 56,
                                    fit: BoxFit.cover,
                                    memCacheWidth: 168,
                                    fadeInDuration: Duration.zero,
                                    placeholder: (_, __) => Container(
                                      width: 56,
                                      height: 56,
                                      color: AppColors.cardDark,
                                      alignment: Alignment.center,
                                      child: const SizedBox(
                                        width: 22,
                                        height: 22,
                                        child: CircularProgressIndicator(strokeWidth: 2),
                                      ),
                                    ),
                                    errorWidget: (_, __, ___) => Container(
                                      width: 56,
                                      height: 56,
                                      color: AppColors.cardDark,
                                      alignment: Alignment.center,
                                      child: const Icon(Icons.person, color: AppColors.textSecondary, size: 32),
                                    ),
                                  )
                                : Container(
                                    width: 56,
                                    height: 56,
                                    color: AppColors.cardDark,
                                    alignment: Alignment.center,
                                    child: const Icon(Icons.person, color: AppColors.textSecondary, size: 32),
                                  ),
                          ),
                          const SizedBox(width: 16),
                          Expanded(
                            child: Text(
                              p.personaName,
                              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600),
                            ),
                          ),
                        ],
                      ),
                      if (p.profileUrl.isNotEmpty) ...[
                        const SizedBox(height: 12),
                        TextButton.icon(
                          onPressed: () async {
                            final uri = Uri.parse(p.profileUrl);
                            await url_launcher.launchUrl(
                              uri,
                              mode: url_launcher.LaunchMode.externalApplication,
                            );
                          },
                          icon: const Icon(Icons.open_in_new, size: 18),
                          label: Text(l10n.get('steam_open_profile')),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 12),
              ElevatedButton.icon(
                onPressed: () async {
                  try {
                    await SteamProviderActions.instance.sync();
                    await SteamProviderActions.instance.loadProfile();
                    if (!mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(l10n.get('steam_sync_success'))),
                    );
                  } catch (_) {
                    if (!mounted) return;
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(content: Text(l10n.get('steam_sync_failed_toast'))),
                    );
                  }
                },
                icon: const Icon(Icons.sync),
                label: Text(l10n.get('steam_sync_now')),
              ),
              const SizedBox(height: 10),
              _entry(context, l10n.get('steam_menu_friends'), () => const SteamFriendsPage()),
              _entry(context, l10n.get('steam_menu_owned'), () => const SteamOwnedGamesPage()),
              _entry(context, l10n.get('steam_menu_recent'), () => const SteamRecentGamesPage()),
              _entry(context, l10n.get('steam_menu_favorites'), () => const SteamFavoritesPage()),
              const SizedBox(height: 12),
              Card(
                child: ListTile(
                  leading: const Icon(Icons.privacy_tip_outlined),
                  title: Text(l10n.get('steam_privacy_notice_title')),
                  subtitle: Text(l10n.get('steam_privacy_notice_body')),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _entry(BuildContext context, String title, Widget Function() builder) {
    return Card(
      child: ListTile(
        title: Text(title),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => builder())),
      ),
    );
  }
}

class _ErrorRetry extends StatelessWidget {
  const _ErrorRetry({required this.message, required this.onRetry});
  final String message;
  final VoidCallback onRetry;
  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Center(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Padding(padding: const EdgeInsets.symmetric(horizontal: 24), child: Text(message, textAlign: TextAlign.center)),
        const SizedBox(height: 12),
        ElevatedButton(onPressed: onRetry, child: Text(l10n.get('retry'))),
      ]),
    );
  }
}
