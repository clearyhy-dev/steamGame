import 'dart:async';

import 'package:flutter/material.dart';

import '../../../core/services/analytics_service.dart';
import '../../../core/steam_auth_events.dart';
import '../../../core/theme/colors.dart';
import '../../../l10n/app_localizations.dart';
import '../../../models/game_model.dart';
import '../detail/game_detail_page.dart';
import '../steam/presentation/pages/steam_overview_page.dart';
import '../subscription/subscription_page.dart';
import 'home_feed_controller.dart';
import 'widgets/home_best_deals_section.dart';
import 'widgets/home_best_deals_to_buy_section.dart';
import 'widgets/home_steam_snapshot_section.dart';
import 'widgets/home_welcome_header.dart';
import '../../../widgets/ad_banner.dart';

/// 个性化首页：欢迎区、Steam 摘要、今日好价、广告（愿望单决策与「为你推荐」在发现页）。
class HomePage extends StatefulWidget {
  const HomePage({super.key});

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final HomeFeedController _c = HomeFeedController();
  StreamSubscription<SteamAuthSuccessPayload>? _steamAuthSub;

  @override
  void initState() {
    super.initState();
    _c.addListener(_onCtl);
    _steamAuthSub = SteamAuthEvents.instance.stream.listen((_) {
      _c.load();
    });
    _c.load().then((_) {
      AnalyticsService.instance.logAppOpen(source: 'home');
    });
  }

  void _onCtl() {
    if (!mounted) return;
    setState(() {});
  }

  @override
  void dispose() {
    _steamAuthSub?.cancel();
    _c.removeListener(_onCtl);
    _c.dispose();
    super.dispose();
  }

  void _openDetail(GameModel game) {
    AnalyticsService.instance.logRecommendationClick(
      section: 'best_deals',
      steamAppId: game.steamAppID.isNotEmpty ? game.steamAppID : game.appId,
      reasonCodes: const [],
    );
    Navigator.of(context).push(
      PageRouteBuilder(
        pageBuilder: (_, __, ___) => GameDetailPage(game: game),
        transitionsBuilder: (_, a, __, c) => FadeTransition(opacity: a, child: c),
        transitionDuration: const Duration(milliseconds: 200),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final footerIso = _footerTimestampIso();
    return Scaffold(
      backgroundColor: AppColors.background,
      body: SafeArea(
        child: RefreshIndicator(
          onRefresh: () => _c.load(showSteamSectionLoading: false),
          child: ListView(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
            children: [
              HomeWelcomeHeader(
                steamLinked: _c.steamLinkedUi,
              ),
              const SizedBox(height: 20),
              HomeSteamSnapshotSection(
                loading: _c.statsLoading,
                steamLinked: _c.steamLinkedUi,
                summary: _c.statsSummary,
                friendCount: _c.steamFriendCount,
                friendsOnline: _c.steamFriendsOnline,
                onOpenFull: () {
                  Navigator.of(context).push(
                    MaterialPageRoute<void>(builder: (_) => const SteamOverviewPage()),
                  );
                },
              ),
              const SizedBox(height: 18),
              HomeBestDealsToBuySection(
                games: _c.bestDealsToBuy,
                onOpenDetail: _openDetail,
              ),
              if (_c.bestDealsToBuy.isNotEmpty) const SizedBox(height: 18),
              HomeBestDealsSection(
                topDeal: _c.topDeal,
                top10: _c.top10,
                isPro: _c.isPro,
                queryLimitReached: _c.queryLimitReached,
                onOpenDetail: _openDetail,
                onTapUpgrade: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(builder: (_) => const SubscriptionPage(paywallSource: 'home')),
                ),
              ),
              const SizedBox(height: 28),
              if (!_c.isPro) const AdBanner(),
              if (footerIso.isNotEmpty) ...[
                const SizedBox(height: 20),
                Text(
                  _formatUpdatedAt(context, footerIso),
                  style: const TextStyle(fontSize: 12, color: AppColors.textSecondary),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }

  String _footerTimestampIso() => _c.updatedAt?.trim() ?? '';

  String _formatUpdatedAt(BuildContext context, String iso) {
    try {
      final dt = DateTime.parse(iso);
      return '${AppLocalizations.of(context).get('updated_today')} ${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';
    } catch (_) {
      return AppLocalizations.of(context).get('updated_today');
    }
  }
}
