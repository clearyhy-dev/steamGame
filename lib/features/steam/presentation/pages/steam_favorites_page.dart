import 'package:flutter/material.dart';
import '../../../../core/theme/colors.dart';
import '../providers/steam_providers.dart';

class SteamFavoritesPage extends StatefulWidget {
  const SteamFavoritesPage({super.key});

  @override
  State<SteamFavoritesPage> createState() => _SteamFavoritesPageState();
}

class _SteamFavoritesPageState extends State<SteamFavoritesPage> {
  @override
  void initState() {
    super.initState();
    SteamProviderActions.instance.loadFavorites();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('My Favorites')),
      body: ValueListenableBuilder(
        valueListenable: steamFavoritesProvider,
        builder: (_, state, __) {
          if (state.loading) return const Center(child: CircularProgressIndicator());
          if (state.error != null) return _ErrorRetry(message: state.error!, onRetry: () => SteamProviderActions.instance.loadFavorites());
          final list = state.data ?? const [];
          if (list.isEmpty) return const Center(child: Text('暂无收藏'));
          return ListView.builder(
            itemCount: list.length,
            itemBuilder: (_, i) {
              final g = list[i];
              return ListTile(
                leading: g.headerImage.isNotEmpty ? Image.network(g.headerImage, width: 56, fit: BoxFit.cover) : null,
                title: Text(g.name),
                trailing: IconButton(
                  icon: const Icon(Icons.delete_outline),
                  onPressed: () async {
                    await SteamProviderActions.instance.removeFavorite(g.appid);
                    await SteamProviderActions.instance.loadFavorites();
                  },
                ),
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
    return Center(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Padding(padding: const EdgeInsets.symmetric(horizontal: 24), child: Text(message, textAlign: TextAlign.center)),
        const SizedBox(height: 12),
        ElevatedButton(onPressed: onRetry, child: const Text('Retry')),
      ]),
    );
  }
}

