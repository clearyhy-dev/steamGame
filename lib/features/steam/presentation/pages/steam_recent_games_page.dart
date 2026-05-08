import 'package:flutter/material.dart';
import '../../../../core/theme/colors.dart';
import '../../../../core/navigation/game_detail_navigation.dart';
import '../../../../l10n/app_localizations.dart';
import '../providers/steam_providers.dart';

class SteamRecentGamesPage extends StatefulWidget {
  const SteamRecentGamesPage({super.key});

  @override
  State<SteamRecentGamesPage> createState() => _SteamRecentGamesPageState();
}

class _SteamRecentGamesPageState extends State<SteamRecentGamesPage> {
  @override
  void initState() {
    super.initState();
    SteamProviderActions.instance.loadRecentGames();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final dash = l10n.get('steam_dash');
    final hoursLine = l10n
        .get('steam_recent_playtime_placeholder')
        .replaceAll('{w}', dash)
        .replaceAll('{t}', dash);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: Text(l10n.get('steam_recent_title'))),
      body: ValueListenableBuilder(
        valueListenable: steamRecentGamesProvider,
        builder: (_, state, __) {
          if (state.loading) return const Center(child: CircularProgressIndicator());
          if (state.error != null) {
            return _ErrorRetry(message: state.error!, onRetry: () => SteamProviderActions.instance.loadRecentGames());
          }
          final list = state.data ?? const [];
          if (list.isEmpty) {
            return Center(child: Text(l10n.get('steam_no_recent_visible')));
          }
          return ListView.builder(
            itemCount: list.length,
            itemBuilder: (_, i) {
              final g = list[i];
              return ListTile(
                leading: g.headerImage.isNotEmpty ? Image.network(g.headerImage, width: 56, fit: BoxFit.cover) : null,
                title: Text(g.name),
                subtitle: Text(hoursLine),
                onTap: () {
                  Navigator.of(context).push(gameDetailRouteByAppId(g.appid));
                },
              );
            },
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
