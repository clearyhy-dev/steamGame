import 'package:flutter/material.dart';
import 'package:cached_network_image/cached_network_image.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart' as url_launcher;
import 'package:fl_chart/fl_chart.dart';
import 'package:intl/intl.dart';
import '../../../core/models/game.dart';
import '../../../core/current_players_cache.dart';
import '../../../core/theme/colors.dart';
import '../../../core/services/algorithm_service.dart';
import '../../../core/services/wishlist_service.dart';
import '../../../core/storage_service.dart';
import '../../../core/app_remote_config.dart';
import '../../../core/price_region_events.dart';
import '../../../core/utils/price_region_resolver.dart';
import '../../../core/utils/price_formatter.dart';
import '../../../core/utils/countdown_util.dart';
import '../../../l10n/app_localizations.dart';
import '../../../services/steam_api_service.dart';
import '../../../services/steam_backend_service.dart';
import '../../../widgets/ad_banner.dart';
import '../subscription/subscription_page.dart';
import '../../../models/store_offer.dart' show buildMockStoreOffers;
import '../../../services/price_engine.dart';
import 'widgets/game_best_price_card.dart';

/// 商业版详情页：多图轮播 + 折扣 + AI 评分 + Steam 跳转 + 分享(deep link) + 愿望单 + 倒计时
class GameDetailPage extends StatefulWidget {
  final GameModel game;

  const GameDetailPage({super.key, required this.game});

  @override
  State<GameDetailPage> createState() => _GameDetailPageState();
}

class _GameDetailPageState extends State<GameDetailPage> {
  final WishlistService _wishlist = WishlistService();
  final SteamApiService _steamApi = SteamApiService();
  late PageController _pageController;
  bool _inWishlist = false;
  List<String> _imageUrls = [];
  int _currentImageIndex = 0;
  List<Map<String, dynamic>> _pricePoints = [];
  List<Map<String, dynamic>> _topReviews = [];

  /// Steam `appreviews` 返回的 [query_summary]（总评文案、好评率、条数），与登录 token 无关。
  Map<String, dynamic>? _reviewSummary;
  int? _currentPlayers;
  late final PriceResult _priceResult;
  final SteamBackendService _backend = SteamBackendService();
  String _boundDiscountUrl = '';
  List<Map<String, dynamic>> _dealLinks = [];
  String _dealCountryCode = 'US';
  bool _isPro = false;
  bool _refreshingDeals = false;
  bool _allDealsLoaded = false;
  bool _metaEnsured = false;
  bool _autoRefreshedDeals = false;
  DateTime? _dealsCacheUpdatedAt;
  bool _dealsUsingCache = false;
  String _priceCountry = 'US';
  Map<String, dynamic>? _steamRegionalPrice;

  String _resolvedSteamId() {
    final fromSteam = widget.game.steamAppID.trim();
    if (fromSteam.isNotEmpty) return fromSteam;
    final fromApp = widget.game.appId.trim();
    if (RegExp(r'^\d+$').hasMatch(fromApp)) return fromApp;
    return '';
  }

  @override
  void initState() {
    super.initState();
    _pageController = PageController();
    _imageUrls = widget.game.images.isNotEmpty
        ? List<String>.from(widget.game.images)
        : (widget.game.image.isNotEmpty ? [widget.game.image] : []);
    _checkWishlist();
    _loadMoreImages();
    _loadPriceHistory();
    _loadReviews();
    _loadCurrentPlayers();
    _loadBoundDiscountUrl();
    _loadSteamRegionalPrice();
    _loadSteamDealLinks();
    _ensureBackendMeta();
    _priceResult = PriceEngineService()
        .calculateBestPrice(buildMockStoreOffers(widget.game));
    PriceRegionEvents.instance.changed.addListener(_onPriceRegionChanged);
  }

  @override
  void dispose() {
    PriceRegionEvents.instance.changed.removeListener(_onPriceRegionChanged);
    _pageController.dispose();
    super.dispose();
  }

  void _onPriceRegionChanged() {
    _loadSteamRegionalPrice();
    _loadSteamDealLinks();
    _loadBoundDiscountUrl();
  }

  Future<void> _ensureBackendMeta() async {
    if (_metaEnsured) return;
    final steamId = widget.game.steamAppID.trim().isNotEmpty
        ? widget.game.steamAppID.trim()
        : widget.game.appId.trim();
    if (steamId.isEmpty) return;
    _metaEnsured = true;
    try {
      await _backend.ensureGameMeta(steamId);
      await _loadBoundDiscountUrl();
      await _loadSteamDealLinks();
    } catch (_) {}
  }

  Future<void> _loadSteamDealLinks() async {
    final steamId = widget.game.steamAppID.trim().isNotEmpty
        ? widget.game.steamAppID.trim()
        : widget.game.appId.trim();
    if (steamId.isEmpty) return;
    if (mounted) {
      setState(() {
        _refreshingDeals = true;
      });
    }
    final region = await PriceRegionResolver.resolveContext();
    _priceCountry = region.country;
    try {
      final pro = await StorageService.instance.isPro();
      final data =
          await _backend.getGameDeals(steamId, country: region.country);
      final countryCode =
          (data['countryCode']?.toString() ?? 'US').trim().toUpperCase();
      final rows = _selectCountryRows(data, countryCode);
      if (!mounted) return;
      setState(() {
        _dealLinks = rows;
        _dealCountryCode = countryCode;
        _isPro = pro;
        _allDealsLoaded = true;
        _dealsUsingCache = false;
        _dealsCacheUpdatedAt = DateTime.now();
      });
      await StorageService.instance.setDetailDealsCache(
        appid: steamId,
        countryCode: countryCode,
        rows: rows,
      );
      await _refreshDealsIfMissingOtherPlatforms();
    } catch (e) {
      debugPrint('detail:getGameDeals failed($steamId): $e');
      await _loadDealsFromCache(steamId);
    } finally {
      if (mounted) {
        setState(() {
          _refreshingDeals = false;
        });
      }
    }
  }

  Future<void> _loadSteamRegionalPrice() async {
    final steamId = _resolvedSteamId();
    if (steamId.isEmpty) return;
    try {
      final data = await _backend.getSteamRegionalPrice(steamId);
      if (!mounted) return;
      setState(() {
        _steamRegionalPrice = data;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _steamRegionalPrice = null;
      });
    }
  }

  bool _hasAnyOtherPlatformPrice() {
    for (final d in _dealLinks) {
      final source = (d['source']?.toString() ?? '').toLowerCase();
      if (source == 'isthereanydeal' ||
          source == 'ggdeals' ||
          source == 'cheapshark') {
        final p = d['finalPrice'];
        final n =
            p is num ? p.toDouble() : double.tryParse('${d['finalPrice']}');
        if (n != null && n > 0) return true;
      }
    }
    return false;
  }

  Future<void> _refreshDealsIfMissingOtherPlatforms() async {
    if (_autoRefreshedDeals) return;
    if (_hasAnyOtherPlatformPrice()) return;
    final steamId = _resolvedSteamId();
    if (steamId.isEmpty) return;
    _autoRefreshedDeals = true;
    if (mounted) setState(() => _refreshingDeals = true);
    final region = await PriceRegionResolver.resolveContext();
    try {
      await _backend.refreshGameDeals(steamId, country: region.country);
      final data =
          await _backend.getGameDeals(steamId, country: region.country);
      final countryCode = (data['countryCode']?.toString() ?? _dealCountryCode)
          .trim()
          .toUpperCase();
      final rows = _selectCountryRows(data, countryCode);
      if (!mounted) return;
      setState(() {
        _dealLinks = rows;
        _dealCountryCode = countryCode;
        _dealsUsingCache = false;
        _dealsCacheUpdatedAt = DateTime.now();
      });
      await StorageService.instance.setDetailDealsCache(
        appid: steamId,
        countryCode: countryCode,
        rows: rows,
      );
    } catch (_) {
      // ignore and keep current data
    } finally {
      if (mounted) setState(() => _refreshingDeals = false);
    }
  }

  Future<void> _ensureAllDealsLoaded() async {
    if (_allDealsLoaded) return;
    final steamId = widget.game.steamAppID.trim().isNotEmpty
        ? widget.game.steamAppID.trim()
        : widget.game.appId.trim();
    if (steamId.isEmpty) return;
    final region = await PriceRegionResolver.resolveContext();
    final data = await _backend.getGameDeals(steamId, country: region.country);
    final countryCode = (data['countryCode']?.toString() ?? _dealCountryCode)
        .trim()
        .toUpperCase();
    final rows = _selectCountryRows(data, countryCode);
    if (!mounted) return;
    setState(() {
      _dealLinks = rows;
      _dealCountryCode = countryCode;
      _allDealsLoaded = true;
      _dealsUsingCache = false;
      _dealsCacheUpdatedAt = DateTime.now();
    });
    await StorageService.instance.setDetailDealsCache(
      appid: steamId,
      countryCode: countryCode,
      rows: rows,
    );
  }

  List<Map<String, dynamic>> _selectCountryRows(
      Map<String, dynamic> data, String countryCode) {
    final allRows = (data['links'] as List<dynamic>? ?? [])
        .whereType<Map>()
        .map((e) => e.map((k, v) => MapEntry(k.toString(), v)))
        .toList();
    final scopedRows = allRows
        .where((e) =>
            (e['countryCode']?.toString() ?? '').trim().toUpperCase() ==
            countryCode)
        .toList();
    return scopedRows.isNotEmpty ? scopedRows : allRows;
  }

  Future<void> _loadDealsFromCache(String steamId) async {
    final countryCode = _dealCountryCode.isNotEmpty ? _dealCountryCode : 'US';
    final cache = await StorageService.instance.getDetailDealsCache(
      appid: steamId,
      countryCode: countryCode,
    );
    if (!mounted || cache.rows.isEmpty) return;
    setState(() {
      _dealLinks = cache.rows;
      _dealCountryCode = countryCode;
      _dealsCacheUpdatedAt = cache.savedAt;
      _dealsUsingCache = true;
      _allDealsLoaded = true;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('网络波动，已展示最近一次价格缓存')),
    );
  }

  Future<void> _loadBoundDiscountUrl() async {
    final steamId = widget.game.steamAppID.trim().isNotEmpty
        ? widget.game.steamAppID.trim()
        : widget.game.appId.trim();
    if (steamId.isEmpty) return;
    final region = await PriceRegionResolver.resolveContext();
    try {
      final url =
          await _backend.getGameDiscountLink(steamId, country: region.country);
      if (!mounted) return;
      setState(() {
        _boundDiscountUrl = url.trim();
      });
    } catch (_) {}
  }

  Future<void> _loadCurrentPlayers() async {
    final steamId = _resolvedSteamId();
    if (steamId.isEmpty) return;
    final count = await _steamApi.fetchCurrentPlayers(steamId);
    if (count != null) CurrentPlayersCache.set(widget.game.steamAppID, count);
    if (mounted && count != null) setState(() => _currentPlayers = count);
  }

  Future<void> _loadPriceHistory() async {
    final g = widget.game;
    final steamId = _resolvedSteamId();
    if (steamId.isEmpty) return;
    final points = await _steamApi.fetchPriceHistory(
      steamId,
      g.price,
      g.originalPrice > 0 ? g.originalPrice : g.price,
      lastChangeSec: g.lastChange,
    );
    if (mounted) setState(() => _pricePoints = points);
  }

  Future<void> _loadReviews() async {
    final steamId = _resolvedSteamId();
    if (steamId.isEmpty) return;
    final result = await _steamApi.fetchSteamReviews(steamId, latestN: 10);
    if (!mounted) return;
    setState(() {
      _topReviews = result.reviews;
      _reviewSummary = result.summary;
    });
  }

  /// 若当前只有 1 张图且有 steamAppID，从 Steam 商店 API 拉取多张截图用于轮播
  Future<void> _loadMoreImages() async {
    final steamId = _resolvedSteamId();
    if (steamId.isEmpty) return;
    final region = await PriceRegionResolver.resolveContext();
    try {
      final list = await _steamApi.fetchSteamScreenshots(steamId,
          country: region.country);
      if (list.isEmpty || !mounted) return;
      final fallbackCover =
          widget.game.image.isNotEmpty ? widget.game.image : '';
      final merged = <String>[
        ...list,
        if (fallbackCover.isNotEmpty && !list.contains(fallbackCover))
          fallbackCover,
      ];
      setState(() => _imageUrls = merged);
    } catch (_) {}
  }

  Future<void> _checkWishlist() async {
    final inList = await _wishlist.isInWishlist(widget.game.appId);
    if (mounted) setState(() => _inWishlist = inList);
  }

  String get _storeUrl => widget.game.steamAppID.isNotEmpty
      ? (_boundDiscountUrl.isNotEmpty
          ? _boundDiscountUrl
          : 'https://store.steampowered.com/app/${widget.game.steamAppID}')
      : (_boundDiscountUrl.isNotEmpty ? _boundDiscountUrl : '');

  String get _steamStoreUrl {
    final steamId = _resolvedSteamId();
    if (steamId.isEmpty) return '';
    return 'https://store.steampowered.com/app/$steamId';
  }

  Future<void> _openSteam() async {
    final steamId = _resolvedSteamId();
    final webUrl = _steamStoreUrl;
    if (steamId.isEmpty || webUrl.isEmpty) return;
    debugPrint('detail:steamTap source=best_price_card appid=$steamId');
    final candidates = <Uri>[
      Uri.parse('steam://store/$steamId'),
      Uri.parse('steam://openurl/$webUrl'),
      Uri.parse(
          'market://details?id=com.valvesoftware.android.steam.community'),
      Uri.parse(
          'https://play.google.com/store/apps/details?id=com.valvesoftware.android.steam.community'),
      Uri.parse(webUrl),
    ];
    for (final uri in candidates) {
      try {
        debugPrint('detail:steamLaunch try=$uri');
        final ok = await url_launcher.launchUrl(
          uri,
          mode: url_launcher.LaunchMode.externalApplication,
        );
        debugPrint('detail:steamLaunch result uri=$uri ok=$ok');
        if (ok) {
          if (!mounted) return;
          if (uri.scheme == 'market' || uri.host.contains('play.google.com')) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('未检测到 Steam App，已为你打开应用商店')),
            );
          }
          return;
        }
      } catch (_) {
        debugPrint('detail:steamLaunch failed uri=$uri');
      }
    }
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('暂时无法打开 Steam，请稍后重试')),
    );
  }

  Future<void> _toggleWishlist() async {
    if (_inWishlist) {
      await _wishlist.remove(widget.game.appId);
    } else {
      await _wishlist.add(widget.game);
    }
    if (mounted) setState(() => _inWishlist = !_inWishlist);
  }

  Future<void> _toggleWishlistWithProGate() async {
    final pro = await StorageService.instance.isPro();
    if (!pro) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('愿望单功能仅会员可用，请先开通会员')),
      );
      await Navigator.push(
        context,
        MaterialPageRoute(
            builder: (_) =>
                const SubscriptionPage(paywallSource: 'wishlist_gate')),
      );
      if (!mounted) return;
      setState(() => _isPro = false);
      return;
    }
    if (!mounted) return;
    setState(() => _isPro = true);
    await _toggleWishlist();
  }

  Future<void> _onTapDealSource(String source) async {
    final regionCfg = AppRemoteConfig.instance.regionSettings;
    if (regionCfg.showRegionWarning) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (_) => AlertDialog(
          title: const Text('Region Notice'),
          content: const Text(
              'This deal may have activation restrictions.'),
          actions: [
            TextButton(
                onPressed: () => Navigator.pop(context, false),
                child: const Text('Cancel')),
            FilledButton(
                onPressed: () => Navigator.pop(context, true),
                child: const Text('Continue')),
          ],
        ),
      );
      if (ok != true) return;
    }
    if (source == 'steam') {
      await _openSteam();
      return;
    }
    final pro = await StorageService.instance.isPro();
    if (!pro) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('已为你展示该平台最低价，开通会员后可查看购买链接并跳转购买')),
      );
      await Navigator.push(
        context,
        MaterialPageRoute(
            builder: (_) =>
                const SubscriptionPage(paywallSource: 'deal_source_gate')),
      );
      if (!mounted) return;
      setState(() => _isPro = false);
      return;
    }
    if (!mounted) return;
    setState(() => _isPro = true);
    // 重新按当前手机国家请求一次，避免用到历史缓存国家的数据。
    await _loadSteamDealLinks();
    await _ensureAllDealsLoaded();
    final rows = _dealLinks
        .where((d) => (d['source']?.toString() ?? '') == source)
        .toList();
    if (rows.isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('该平台当前暂无可用折扣信息')));
      return;
    }
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: const Color(0xFF151A22),
      builder: (_) => SafeArea(
        child: ListView.separated(
          shrinkWrap: true,
          itemCount: rows.length,
          separatorBuilder: (_, __) =>
              const Divider(height: 1, color: Colors.white12),
          itemBuilder: (_, i) {
            final r = rows[i];
            final cc = (r['countryCode'] ?? 'US').toString();
            final discount = r['discountPercent'];
            final url = (r['url'] ?? '').toString();
            final original = r['originalPrice'];
            final finalPrice = r['finalPrice'];
            final ctx = PriceRegionResolver.resolveSync();
            final rowCurrency = (r['currency']?.toString() ?? '').trim().toUpperCase();
            final currency = rowCurrency.isNotEmpty ? rowCurrency : ctx.currency;
            final originalNum = original is num ? original.toDouble() : double.tryParse('$original');
            final finalNum = finalPrice is num ? finalPrice.toDouble() : double.tryParse('$finalPrice');
            final sameRegion = cc.toUpperCase() == ctx.country.toUpperCase();
            return ListTile(
              title: Text(
                '$source ($cc${_dealCountryCode.isNotEmpty ? ' · 当前$_dealCountryCode' : ''})',
                style: const TextStyle(
                    color: Colors.white, fontWeight: FontWeight.w600),
              ),
              subtitle: Text(
                !sameRegion
                    ? 'No regional deal available'
                    : '${discount is num ? '折扣 ${discount.toInt()}%' : '折扣信息'}'
                        '${(originalNum != null || finalNum != null) ? ' · 原价 ${formatRegionalPrice(amount: originalNum, currency: currency)} 现价 ${formatRegionalPrice(amount: finalNum, currency: currency)}' : ''}',
                style: const TextStyle(color: Colors.white70),
              ),
              trailing: const Icon(Icons.open_in_new,
                  color: Colors.white70, size: 18),
              onTap: () async {
                if (url.isEmpty) return;
                final uri = Uri.parse(url);
                if (await url_launcher.canLaunchUrl(uri)) {
                  await url_launcher.launchUrl(uri,
                      mode: url_launcher.LaunchMode.externalApplication);
                }
              },
            );
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final game = widget.game;
    final l10n = AppLocalizations.of(context);
    final regionCtx = PriceRegionResolver.resolveSync();
    final score = AlgorithmService().calculateScore(game);
    final imageUrls = _imageUrls.isNotEmpty
        ? _imageUrls
        : (game.image.isNotEmpty ? [game.image] : []);
    final hasImages = imageUrls.isNotEmpty && imageUrls.first.isNotEmpty;

    return Scaffold(
      backgroundColor: const Color(0xFF0E1116),
      body: CustomScrollView(
        slivers: [
          SliverAppBar(
            expandedHeight: 260,
            pinned: true,
            backgroundColor: const Color(0xFF151A22),
            flexibleSpace: FlexibleSpaceBar(
              background: hasImages
                  ? PageView.builder(
                      controller: _pageController,
                      onPageChanged: (i) =>
                          setState(() => _currentImageIndex = i),
                      itemCount: imageUrls.length,
                      itemBuilder: (_, i) => CachedNetworkImage(
                        imageUrl: imageUrls[i],
                        fit: BoxFit.cover,
                        placeholder: (_, __) =>
                            const ColoredBox(color: AppColors.cardDark),
                        errorWidget: (_, __, ___) =>
                            const ColoredBox(color: AppColors.cardDark),
                      ),
                    )
                  : const ColoredBox(color: AppColors.cardDark),
            ),
            bottom: imageUrls.length > 1
                ? PreferredSize(
                    preferredSize: const Size.fromHeight(24),
                    child: Padding(
                      padding: const EdgeInsets.only(bottom: 8),
                      child: Row(
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: List.generate(
                          imageUrls.length.clamp(0, 10),
                          (i) => Container(
                            margin: const EdgeInsets.symmetric(horizontal: 3),
                            width: 6,
                            height: 6,
                            decoration: BoxDecoration(
                              shape: BoxShape.circle,
                              color: i == _currentImageIndex
                                  ? Colors.white
                                  : Colors.white24,
                            ),
                          ),
                        ),
                      ),
                    ),
                  )
                : null,
            actions: [
              IconButton(
                icon:
                    Icon(_inWishlist ? Icons.favorite : Icons.favorite_border),
                color: _inWishlist ? AppColors.discountRed : Colors.white70,
                onPressed: _toggleWishlistWithProGate,
              ),
              IconButton(
                icon: const Icon(Icons.share),
                onPressed: () {
                  if (mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                          content: Text(l10n.get('share_return_hint')),
                          duration: const Duration(seconds: 4)),
                    );
                  }
                  Share.share(
                    'Check this deal: ${game.name} 🔥\n${formatRegionalPrice(amount: game.price, currency: regionCtx.currency)}\n$_storeUrl',
                  );
                },
              ),
            ],
          ),
          SliverToBoxAdapter(
            child: Padding(
              padding: const EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    game.name,
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: AppColors.textPrimary,
                    ),
                  ),
                  const SizedBox(height: 10),
                  const Text(
                    'Steam Store Price',
                    style: TextStyle(
                        fontSize: 12,
                        fontWeight: FontWeight.w600,
                        color: AppColors.textSecondary),
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      _priceSection(),
                      const Spacer(),
                      _aiScore(score),
                    ],
                  ),
                  if (game.saleEndTime > 0 || game.lastChange > 0) ...[
                    const SizedBox(height: 10),
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 6),
                      decoration: BoxDecoration(
                        color: AppColors.cardDark,
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        game.saleEndTime > 0
                            ? 'Ends in ${formatCountdown(game.saleEndTime)}'
                            : (game.lastChange > 0
                                ? formatLastChange(game.lastChange)
                                : ''),
                        style: const TextStyle(
                            fontSize: 13, color: AppColors.textSecondary),
                      ),
                    ),
                  ],
                  if (_currentPlayers != null && _currentPlayers! > 0) ...[
                    const SizedBox(height: 10),
                    Row(
                      children: [
                        Icon(Icons.people_outline,
                            size: 18, color: AppColors.textSecondary),
                        const SizedBox(width: 6),
                        Text(
                          '${_formatPlayerCount(_currentPlayers!)} ${l10n.get('playing_now')}',
                          style: const TextStyle(
                              fontSize: 13, color: AppColors.textSecondary),
                        ),
                      ],
                    ),
                  ],
                  const SizedBox(height: 16),
                  GameBestPriceCard(
                    game: game,
                    priceResult: _priceResult,
                    dealLinks: _dealLinks,
                    onTapSource: _onTapDealSource,
                    isPro: _isPro,
                    refreshingDeals: _refreshingDeals,
                    dealsCacheUpdatedAt: _dealsCacheUpdatedAt,
                    dealsUsingCache: _dealsUsingCache,
                    showRegionWarning: AppRemoteConfig
                        .instance.regionSettings.showRegionWarning,
                    selectedCountry: _priceCountry,
                    onAddToWishlist: () {
                      if (!_inWishlist) _toggleWishlistWithProGate();
                    },
                  ),
                  const SizedBox(height: 16),
                  if (AppRemoteConfig.instance.regionSettings.showRegionWarning)
                    Container(
                      width: double.infinity,
                      margin: const EdgeInsets.only(bottom: 12),
                      padding: const EdgeInsets.symmetric(
                          horizontal: 12, vertical: 10),
                      decoration: BoxDecoration(
                        color: AppColors.cardDark,
                        borderRadius: BorderRadius.circular(10),
                        border: Border.all(color: Colors.white12),
                      ),
                      child: const Text(
                        'Prices may vary by region. Check activation region before purchase.',
                        style: TextStyle(
                            fontSize: 12, color: AppColors.textSecondary),
                      ),
                    ),
                  if (_steamRegionalPrice != null) ...[
                    const SizedBox(height: 8),
                    Text(
                      'Region: ${(_steamRegionalPrice!['country'] ?? regionCtx.country).toString().toUpperCase()}',
                      style: const TextStyle(
                          fontSize: 12, color: AppColors.textSecondary),
                    ),
                    if (_steamRegionalPrice!['fallbackUsed'] == true)
                      const Text(
                        'Price shown in US region.',
                        style: TextStyle(
                            fontSize: 12, color: AppColors.textSecondary),
                      ),
                  ],
                  SizedBox(
                    width: double.infinity,
                    child: OutlinedButton.icon(
                      onPressed: _toggleWishlistWithProGate,
                      icon: Icon(
                          _inWishlist ? Icons.favorite : Icons.favorite_border,
                          size: 20),
                      label: Text(_inWishlist
                          ? l10n.get('remove_from_wishlist')
                          : l10n.get('add_to_wishlist')),
                      style: OutlinedButton.styleFrom(
                        foregroundColor: _inWishlist
                            ? AppColors.discountRed
                            : AppColors.itadOrange,
                        side: BorderSide(
                            color: _inWishlist
                                ? AppColors.discountRed
                                : AppColors.itadOrange),
                        shape: RoundedRectangleBorder(
                            borderRadius: BorderRadius.circular(14)),
                        padding: const EdgeInsets.symmetric(vertical: 14),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const AdBanner(),
                  const SizedBox(height: 20),
                  _sectionCard(
                    l10n.get('ai_score'),
                    score.toStringAsFixed(1),
                    l10n.get('based_on_discount'),
                    valueColor: AppColors.neonPurple,
                  ),
                  const SizedBox(height: 14),
                  _priceHistoryCard(context, game),
                  const SizedBox(height: 14),
                  _reviewsSection(context, game),
                  const SizedBox(height: 20),
                  Row(
                    children: [
                      Expanded(
                        child: OutlinedButton.icon(
                          onPressed: () {
                            if (mounted) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                    content:
                                        Text(l10n.get('share_return_hint')),
                                    duration: const Duration(seconds: 4)),
                              );
                            }
                            Share.share(
                              'Check this deal: ${game.name} 🔥\n${formatRegionalPrice(amount: game.price, currency: regionCtx.currency)}\n$_storeUrl',
                            );
                          },
                          icon: const Icon(Icons.share, size: 20),
                          label: Text(l10n.get('share')),
                          style: OutlinedButton.styleFrom(
                            foregroundColor: AppColors.textPrimary,
                            side: const BorderSide(
                                color: AppColors.textSecondary),
                            shape: RoundedRectangleBorder(
                                borderRadius: BorderRadius.circular(14)),
                            padding: const EdgeInsets.symmetric(vertical: 14),
                          ),
                        ),
                      ),
                      // Purchase is unified in GameBestPriceCard ("Buy Best Price").
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  static String _formatPriceHistoryDate(int tMs) {
    return DateFormat('MM/dd').format(DateTime.fromMillisecondsSinceEpoch(tMs));
  }

  static String _formatPlayerCount(int n) {
    if (n < 1000) return '$n';
    if (n < 1000000)
      return '${(n / 1000).toStringAsFixed(1).replaceAll(RegExp(r'\.0$'), '')}K';
    return '${(n / 1000000).toStringAsFixed(1).replaceAll(RegExp(r'\.0$'), '')}M';
  }

  Widget _priceHistoryCard(BuildContext context, GameModel game) {
    final l10n = AppLocalizations.of(context);
    final priceRegion = PriceRegionResolver.resolveSync();
    final points = _pricePoints;
    if (points.isEmpty) {
      return _sectionCard(
        l10n.get('price_history'),
        '—',
        l10n.get('price_history_no_history'),
        onTap: game.steamAppID.isNotEmpty ? _openSteam : null,
      );
    }
    final spots = points
        .asMap()
        .entries
        .map((e) =>
            FlSpot(e.key.toDouble(), (e.value['price'] as num).toDouble()))
        .toList();
    final prices = points.map((p) => (p['price'] as num).toDouble()).toList();
    final minP = prices.reduce((a, b) => a < b ? a : b);
    final maxP = prices.reduce((a, b) => a > b ? a : b);
    final minY = (minP - 1).clamp(0.0, double.infinity);
    final maxY = maxP + 1;
    final showBottomAt = <int>{0, points.length ~/ 2, points.length - 1}
        .where((i) => i >= 0 && i < points.length)
        .toSet();
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.cardDark,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            l10n.get('price_history'),
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 140,
            child: LineChart(
              LineChartData(
                minX: 0,
                maxX: (spots.length - 1).toDouble(),
                minY: minY,
                maxY: maxY,
                lineBarsData: [
                  LineChartBarData(
                    spots: spots,
                    isCurved: true,
                    color: AppColors.itadOrange,
                    barWidth: 2,
                    dotData: const FlDotData(show: true),
                    belowBarData: BarAreaData(
                        show: true,
                        color: AppColors.itadOrange.withOpacity(0.15)),
                  ),
                ],
                titlesData: FlTitlesData(
                  leftTitles: AxisTitles(
                      sideTitles: SideTitles(
                          showTitles: true,
                          reservedSize: 36,
                          getTitlesWidget: (v, _) => Text(
                              formatRegionalPrice(
                                  amount: v, currency: priceRegion.currency),
                              style: const TextStyle(
                                  color: AppColors.textSecondary,
                                  fontSize: 10)))),
                  bottomTitles: AxisTitles(
                      sideTitles: SideTitles(
                          showTitles: true,
                          reservedSize: 28,
                          getTitlesWidget: (v, _) {
                            final i = v.toInt();
                            if (i < 0 ||
                                i >= points.length ||
                                !showBottomAt.contains(i))
                              return const SizedBox.shrink();
                            final t = points[i]['t'];
                            final tMs =
                                t is int ? t : (t is num ? t.toInt() : 0);
                            final dateStr =
                                tMs > 0 ? _formatPriceHistoryDate(tMs) : '';
                            final priceLabel = formatRegionalPrice(
                                amount: (points[i]['price'] as num).toDouble(),
                                currency: priceRegion.currency);
                            return Text('$dateStr\n$priceLabel',
                                style: const TextStyle(
                                    color: AppColors.textSecondary,
                                    fontSize: 9),
                                textAlign: TextAlign.center,
                                maxLines: 2);
                          })),
                  topTitles: const AxisTitles(
                      sideTitles: SideTitles(showTitles: false)),
                  rightTitles: const AxisTitles(
                      sideTitles: SideTitles(showTitles: false)),
                ),
                gridData: FlGridData(
                    show: true,
                    drawVerticalLine: false,
                    getDrawingHorizontalLine: (_) => FlLine(
                        color: AppColors.textSecondary.withOpacity(0.2))),
                borderData: FlBorderData(show: false),
              ),
              duration: const Duration(milliseconds: 200),
            ),
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 72,
            child: ListView.builder(
              scrollDirection: Axis.horizontal,
              itemCount: points.length,
              itemBuilder: (_, i) {
                final t = points[i]['t'];
                final tMs = t is int ? t : (t is num ? t.toInt() : 0);
                final dateStr = tMs > 0 ? _formatPriceHistoryDate(tMs) : '—';
                final priceLabel = formatRegionalPrice(
                    amount: (points[i]['price'] as num).toDouble(),
                    currency: priceRegion.currency);
                return Padding(
                  padding: const EdgeInsets.only(right: 12),
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: AppColors.cardElevated.withOpacity(0.6),
                      borderRadius: BorderRadius.circular(8),
                    ),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      mainAxisAlignment: MainAxisAlignment.center,
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(dateStr,
                            style: const TextStyle(
                                color: AppColors.textSecondary, fontSize: 10)),
                        Text(priceLabel,
                            style: const TextStyle(
                                color: AppColors.itadOrangeLight,
                                fontSize: 12,
                                fontWeight: FontWeight.w600)),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
          if (game.steamAppID.isNotEmpty) ...[
            const SizedBox(height: 8),
            InkWell(
              onTap: _openSteam,
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(l10n.get('view_full_history_steam'),
                      style: const TextStyle(
                          fontSize: 12,
                          color: AppColors.itadOrange,
                          fontWeight: FontWeight.w600)),
                  const SizedBox(width: 4),
                  const Icon(Icons.open_in_new,
                      size: 12, color: AppColors.itadOrange),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _sectionCard(String title, String value, String subtitle,
      {Color? valueColor, VoidCallback? onTap}) {
    final card = Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.cardDark,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: AppColors.textSecondary,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            value,
            style: TextStyle(
              fontSize: 18,
              fontWeight: FontWeight.bold,
              color: valueColor ?? AppColors.itadOrange,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            subtitle,
            style:
                const TextStyle(fontSize: 12, color: AppColors.textSecondary),
          ),
        ],
      ),
    );
    if (onTap != null) {
      return InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(14),
        child: card,
      );
    }
    return card;
  }

  Widget _reviewsSection(BuildContext context, GameModel game) {
    final l10n = AppLocalizations.of(context);
    final hasSteam = game.steamAppID.isNotEmpty;
    final reviewsUrl = hasSteam
        ? 'https://store.steampowered.com/app/${game.steamAppID}/#app_reviews_hash'
        : '';
    final sm = _reviewSummary;
    final desc = sm?['review_score_desc']?.toString() ?? '';
    final pctVal = sm?['positive_percent'];
    final totalVal = sm?['total_reviews'];
    final pct =
        pctVal is int ? pctVal : (pctVal is num ? pctVal.toInt() : null);
    final totalAll = totalVal is int
        ? totalVal
        : (totalVal is num ? totalVal.toInt() : null);
    final showAggregate =
        sm != null && pct != null && totalAll != null && totalAll > 0;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
      decoration: BoxDecoration(
        color: AppColors.cardDark,
        borderRadius: BorderRadius.circular(14),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Text(
                  l10n.get('top_community_reviews'),
                  style: const TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: AppColors.textSecondary,
                  ),
                ),
              ),
              if (showAggregate)
                Flexible(
                  child: Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
                    decoration: BoxDecoration(
                      color: AppColors.itadOrange.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(10),
                      border: Border.all(
                          color: AppColors.itadOrange.withValues(alpha: 0.35)),
                    ),
                    child: Text(
                      l10n
                          .get('reviews_aggregate_hint')
                          .replaceAll(
                              '{label}', desc.isNotEmpty ? desc : 'Steam')
                          .replaceAll('{pct}', '$pct')
                          .replaceAll('{total}', '$totalAll'),
                      textAlign: TextAlign.right,
                      style: const TextStyle(
                        fontSize: 11,
                        fontWeight: FontWeight.w600,
                        color: AppColors.itadOrange,
                        height: 1.25,
                      ),
                    ),
                  ),
                ),
            ],
          ),
          if (_reviewSummary != null && _topReviews.isNotEmpty)
            Padding(
              padding: const EdgeInsets.only(top: 6),
              child: Text(
                l10n
                    .get('reviews_showing_latest')
                    .replaceAll('{n}', '${_topReviews.length}'),
                style: const TextStyle(
                    fontSize: 11, color: AppColors.textSecondary),
              ),
            )
          else if (game.steamRatingText.isNotEmpty) ...[
            const SizedBox(height: 4),
            Text(
              game.steamRatingText,
              style: const TextStyle(
                  fontSize: 13,
                  color: AppColors.textPrimary,
                  fontWeight: FontWeight.w600),
            ),
            if (game.steamRatingCount > 0)
              Text('${game.steamRatingCount} ${l10n.get('reviews_count')}',
                  style: const TextStyle(
                      fontSize: 11, color: AppColors.textSecondary)),
          ],
          if (_topReviews.isEmpty && hasSteam)
            const Padding(
                padding: EdgeInsets.only(top: 8),
                child: SizedBox(
                    height: 24,
                    child: Center(
                        child: SizedBox(
                            width: 20,
                            height: 20,
                            child:
                                CircularProgressIndicator(strokeWidth: 2))))),
          ..._topReviews.map((r) => _reviewTile(r, l10n)),
          if (hasSteam) ...[
            const SizedBox(height: 10),
            InkWell(
              onTap: () async {
                if (reviewsUrl.isEmpty) return;
                final uri = Uri.parse(reviewsUrl);
                if (await url_launcher.canLaunchUrl(uri)) {
                  await url_launcher.launchUrl(uri,
                      mode: url_launcher.LaunchMode.externalApplication);
                }
              },
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(l10n.get('see_more_on_steam'),
                      style: const TextStyle(
                          fontSize: 13,
                          color: AppColors.itadOrange,
                          fontWeight: FontWeight.w600)),
                  const SizedBox(width: 4),
                  const Icon(Icons.open_in_new,
                      size: 14, color: AppColors.itadOrange),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }

  Widget _reviewTile(Map<String, dynamic> r, AppLocalizations l10n) {
    final content = (r['content'] as String?) ?? '';
    if (content.isEmpty) return const SizedBox.shrink();
    final text =
        content.length > 200 ? '${content.substring(0, 200)}…' : content;
    final votes = (r['votes_up'] as int?) ?? 0;
    final votedUp = r['voted_up'] == true;
    final language = (r['language'] as String?) ?? '';
    final ts = (r['timestamp_created'] as int?) ?? 0;
    String timeStr = '';
    if (ts > 0) {
      final dt = DateTime.fromMillisecondsSinceEpoch(ts * 1000);
      final now = DateTime.now();
      final diff = now.difference(dt);
      if (diff.inDays > 365)
        timeStr = '${(diff.inDays / 365).floor()}y ago';
      else if (diff.inDays > 30)
        timeStr = '${diff.inDays ~/ 30}mo ago';
      else if (diff.inDays > 0)
        timeStr = '${diff.inDays}d ago';
      else if (diff.inHours > 0)
        timeStr = '${diff.inHours}h ago';
      else if (diff.inMinutes > 0)
        timeStr = '${diff.inMinutes}m ago';
      else
        timeStr = l10n.get('just_now');
    }
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(votedUp ? Icons.thumb_up : Icons.thumb_down,
              size: 14,
              color: votedUp ? AppColors.itadOrange : AppColors.textSecondary),
          const SizedBox(width: 6),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(text,
                    style: const TextStyle(
                        fontSize: 13,
                        color: AppColors.textPrimary,
                        height: 1.35)),
                const SizedBox(height: 4),
                Row(
                  children: [
                    Text('$votes ${l10n.get('reviews_helpful')}',
                        style: const TextStyle(
                            fontSize: 11, color: AppColors.textSecondary)),
                    if (timeStr.isNotEmpty) ...[
                      const Text(' · ',
                          style: TextStyle(
                              fontSize: 11, color: AppColors.textSecondary)),
                      Text(timeStr,
                          style: const TextStyle(
                              fontSize: 11, color: AppColors.textSecondary)),
                    ],
                    if (language.isNotEmpty) ...[
                      const Text(' · ',
                          style: TextStyle(
                              fontSize: 11, color: AppColors.textSecondary)),
                      Text(language,
                          style: const TextStyle(
                              fontSize: 11, color: AppColors.textSecondary)),
                    ],
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Widget _priceSection() {
    final game = widget.game;
    final regionCtx = PriceRegionResolver.resolveSync();
    final Map<String, dynamic>? steamRow =
        _dealLinks.cast<Map<String, dynamic>?>().firstWhere(
              (d) => (d?['source']?.toString() ?? '') == 'steam',
              orElse: () => null,
            );
    double? current = game.price;
    double? original = game.originalPrice;
    int discount = game.discount;
    var currency = regionCtx.currency;

    if (_steamRegionalPrice != null) {
      final steamCurrency =
          (_steamRegionalPrice!['currency']?.toString() ?? '').trim().toUpperCase();
      final saleRaw = _steamRegionalPrice!['salePrice'];
      final regularRaw = _steamRegionalPrice!['regularPrice'];
      final saleNum = saleRaw is num ? saleRaw.toDouble() : double.tryParse('$saleRaw');
      final regularNum = regularRaw is num ? regularRaw.toDouble() : double.tryParse('$regularRaw');
      if (saleNum != null) current = saleNum > 1000 ? saleNum / 100.0 : saleNum;
      if (regularNum != null) original = regularNum > 1000 ? regularNum / 100.0 : regularNum;
      if (_steamRegionalPrice!['discountPercent'] is num) {
        discount = (_steamRegionalPrice!['discountPercent'] as num).toInt();
      }
      if (steamCurrency.isNotEmpty) currency = steamCurrency;
    }

    if (steamRow != null) {
      final f = steamRow['finalPrice'];
      final o = steamRow['originalPrice'];
      final d = steamRow['discountPercent'];
      final fv = f is num ? f.toDouble() : double.tryParse(f?.toString() ?? '');
      final ov = o is num ? o.toDouble() : double.tryParse(o?.toString() ?? '');
      // fallback to deals data when steam regional price API is unavailable.
      if (_steamRegionalPrice == null) {
        if (fv != null) current = fv > 1000 ? fv / 100.0 : fv;
        if (ov != null) original = ov > 1000 ? ov / 100.0 : ov;
      }
      if (d is num) discount = d.toInt();
    }
    return Row(
      children: [
        Text(
          formatRegionalPrice(amount: current, currency: currency),
          style: const TextStyle(
            fontSize: 20,
            color: AppColors.itadOrangeLight,
            fontWeight: FontWeight.bold,
          ),
        ),
        if (original > 0) ...[
          const SizedBox(width: 8),
          Text(
            formatRegionalPrice(amount: original, currency: currency),
            style: const TextStyle(
              decoration: TextDecoration.lineThrough,
              color: AppColors.textSecondary,
              fontSize: 16,
            ),
          ),
          if (discount > 0) ...[
            const SizedBox(width: 8),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(
                color: AppColors.itadOrange,
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                '-$discount%',
                style: const TextStyle(
                    color: Colors.white,
                    fontWeight: FontWeight.bold,
                    fontSize: 12),
              ),
            ),
          ],
        ],
      ],
    );
  }

  Widget _aiScore(double score) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.neonPurple,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        'AI ${score.toStringAsFixed(1)}',
        style: const TextStyle(
            color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14),
      ),
    );
  }
}
