import 'package:flutter/material.dart';
import '../../../../core/theme/colors.dart';
import '../../../../l10n/app_localizations.dart';
import '../providers/steam_providers.dart';

class SteamOwnedGamesPage extends StatefulWidget {
  const SteamOwnedGamesPage({super.key});

  @override
  State<SteamOwnedGamesPage> createState() => _SteamOwnedGamesPageState();
}

class _SteamOwnedGamesPageState extends State<SteamOwnedGamesPage> {
  String _q = '';
  @override
  void initState() {
    super.initState();
    SteamProviderActions.instance.loadOwnedGames();
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final dash = l10n.get('steam_dash');
    final playtimeSub = l10n.get('steam_total_playtime_line').replaceAll('{v}', dash);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: Text(l10n.get('steam_menu_owned'))),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              onChanged: (v) => setState(() => _q = v.trim().toLowerCase()),
              decoration: InputDecoration(
                prefixIcon: const Icon(Icons.search),
                hintText: l10n.get('search_hint'),
              ),
            ),
          ),
          Expanded(
            child: ValueListenableBuilder(
              valueListenable: steamOwnedGamesProvider,
              builder: (_, state, __) {
                if (state.loading) return const Center(child: CircularProgressIndicator());
                if (state.error != null) {
                  final msg = state.error!.contains('STEAM_OWNED_UNAVAILABLE')
                      ? l10n.get('steam_no_owned_visible')
                      : state.error!;
                  return _ErrorRetry(message: msg, onRetry: () => SteamProviderActions.instance.loadOwnedGames());
                }
                final all = state.data ?? const [];
                final list = all.where((g) => g.name.toLowerCase().contains(_q)).toList();
                if (all.isEmpty) {
                  return Center(child: Text(l10n.get('steam_no_owned_visible')));
                }
                if (list.isEmpty) {
                  return Center(child: Text(l10n.get('no_results')));
                }
                return ListView.builder(
                  itemCount: list.length,
                  itemBuilder: (_, i) {
                    final g = list[i];
                    return ListTile(
                      leading: g.headerImage.isNotEmpty ? Image.network(g.headerImage, width: 56, fit: BoxFit.cover) : null,
                      title: Text(g.name),
                      subtitle: Text(playtimeSub),
                      trailing: IconButton(
                        icon: const Icon(Icons.favorite_border),
                        onPressed: () async {
                          await SteamProviderActions.instance.addFavorite(g);
                          if (!mounted) return;
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text(l10n.get('steam_favorite_added'))),
                          );
                        },
                      ),
                    );
                  },
                );
              },
            ),
          ),
        ],
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
