import 'package:flutter/material.dart';
import '../../../../core/theme/colors.dart';
import '../../../../l10n/app_localizations.dart';
import '../providers/steam_providers.dart';

class SteamFriendsPage extends StatefulWidget {
  const SteamFriendsPage({super.key});

  @override
  State<SteamFriendsPage> createState() => _SteamFriendsPageState();
}

class _SteamFriendsPageState extends State<SteamFriendsPage> {
  @override
  void initState() {
    super.initState();
    SteamProviderActions.instance.loadFriends();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: Text(l10n.get('steam_friends_title'))),
      body: ValueListenableBuilder(
        valueListenable: steamFriendsProvider,
        builder: (_, state, __) {
          if (state.loading) return const Center(child: CircularProgressIndicator());
          if (state.error != null) {
            final msg = state.error!.contains('STEAM_FRIENDS_PRIVATE')
                ? l10n.get('steam_friends_list_private')
                : state.error!;
            return _ErrorRetry(message: msg, onRetry: () => SteamProviderActions.instance.loadFriends());
          }
          final list = state.data ?? const [];
          if (list.isEmpty) {
            return Center(child: Text(l10n.get('steam_no_friends_visible')));
          }
          return RefreshIndicator(
            onRefresh: SteamProviderActions.instance.loadFriends,
            child: ListView.builder(
              itemCount: list.length,
              itemBuilder: (_, i) {
                final f = list[i];
                return ListTile(
                  leading: CircleAvatar(backgroundImage: f.avatar.isNotEmpty ? NetworkImage(f.avatar) : null),
                  title: Text(f.personaName),
                  subtitle: Text(f.currentGame.isNotEmpty ? '${f.personaLabel} - ${f.currentGame}' : f.personaLabel),
                );
              },
            ),
          );
        },
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
