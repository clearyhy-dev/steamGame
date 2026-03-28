import 'package:flutter/material.dart';
import '../../../../core/theme/colors.dart';
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
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Owned Games')),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(12),
            child: TextField(
              onChanged: (v) => setState(() => _q = v.trim().toLowerCase()),
              decoration: const InputDecoration(prefixIcon: Icon(Icons.search), hintText: 'Search game'),
            ),
          ),
          Expanded(
            child: ValueListenableBuilder(
              valueListenable: steamOwnedGamesProvider,
              builder: (_, state, __) {
                if (state.loading) return const Center(child: CircularProgressIndicator());
                if (state.error != null) {
                  final msg = state.error!.contains('STEAM_OWNED_UNAVAILABLE')
                      ? 'Owned games are not visible due to Steam privacy settings'
                      : state.error!;
                  return _ErrorRetry(message: msg, onRetry: () => SteamProviderActions.instance.loadOwnedGames());
                }
                final all = state.data ?? const [];
                final list = all.where((g) => g.name.toLowerCase().contains(_q)).toList();
                if (list.isEmpty) return const Center(child: Text('暂无拥有游戏'));
                return ListView.builder(
                  itemCount: list.length,
                  itemBuilder: (_, i) {
                    final g = list[i];
                    return ListTile(
                      leading: g.headerImage.isNotEmpty ? Image.network(g.headerImage, width: 56, fit: BoxFit.cover) : null,
                      title: Text(g.name),
                      subtitle: const Text('总游玩时长：--'),
                      trailing: IconButton(
                        icon: const Icon(Icons.favorite_border),
                        onPressed: () async {
                          await SteamProviderActions.instance.addFavorite(g);
                          if (!mounted) return;
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('已添加到收藏')));
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
    return Center(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Padding(padding: const EdgeInsets.symmetric(horizontal: 24), child: Text(message, textAlign: TextAlign.center)),
        const SizedBox(height: 12),
        ElevatedButton(onPressed: onRetry, child: const Text('Retry')),
      ]),
    );
  }
}

