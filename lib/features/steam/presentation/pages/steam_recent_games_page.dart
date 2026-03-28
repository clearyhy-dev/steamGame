import 'package:flutter/material.dart';
import '../../../../core/theme/colors.dart';
import '../../../../screens/detail_screen.dart';
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
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(title: const Text('Recent Games')),
      body: ValueListenableBuilder(
        valueListenable: steamRecentGamesProvider,
        builder: (_, state, __) {
          if (state.loading) return const Center(child: CircularProgressIndicator());
          if (state.error != null) return _ErrorRetry(message: state.error!, onRetry: () => SteamProviderActions.instance.loadRecentGames());
          final list = state.data ?? const [];
          if (list.isEmpty) return const Center(child: Text('暂无最近游戏'));
          return ListView.builder(
            itemCount: list.length,
            itemBuilder: (_, i) {
              final g = list[i];
              return ListTile(
                leading: g.headerImage.isNotEmpty ? Image.network(g.headerImage, width: 56, fit: BoxFit.cover) : null,
                title: Text(g.name),
                subtitle: const Text('近两周：-- 小时   总时长：-- 小时'),
                onTap: () {
                  Navigator.of(context).push(MaterialPageRoute(builder: (_) => DetailScreen(appId: g.appid)));
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
    return Center(
      child: Column(mainAxisSize: MainAxisSize.min, children: [
        Padding(padding: const EdgeInsets.symmetric(horizontal: 24), child: Text(message, textAlign: TextAlign.center)),
        const SizedBox(height: 12),
        ElevatedButton(onPressed: onRetry, child: const Text('Retry')),
      ]),
    );
  }
}

