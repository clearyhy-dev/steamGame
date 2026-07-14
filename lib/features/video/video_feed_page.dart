import 'dart:async' show unawaited;

import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';

import '../../core/app_country_resolver.dart';
import '../../core/storage_service.dart';
import '../../core/utils/user_facing_error.dart';
import '../../core/theme/colors.dart';
import '../../core/utils/price_formatter.dart';
import '../../core/utils/price_region_resolver.dart';
import '../../core/utils/steam_price_amount.dart' show normalizeDealPriceAmount;
import '../../l10n/app_localizations.dart';
import '../../features/detail/game_detail_page.dart';
import '../../features/recommendation/models/recommended_item.dart';
import '../../models/game_model.dart';
import '../../services/market_v2_adapter.dart';
import '../../services/steam_backend_service.dart';

class VideoFeedPage extends StatefulWidget {
  final String? initialVideoId;

  const VideoFeedPage({super.key, this.initialVideoId});

  @override
  State<VideoFeedPage> createState() => _VideoFeedPageState();
}

class _VideoFeedPageState extends State<VideoFeedPage> {
  final SteamBackendService _backend = SteamBackendService();
  final PageController _pageController = PageController();
  List<Map<String, dynamic>> _items = [];
  String? _cursor;
  bool _loading = true;
  String? _error;
  bool _playbackLoading = false;
  String? _playbackError;
  int? _playbackErrorIndex;
  int _currentIndex = 0;
  VideoPlayerController? _controller;
  String? _playbackVideoId;
  String? _likingVideoId;

  String _resolveSteamAppId(Map<String, dynamic> item) {
    final game = item['game'];
    final candidates = <String?>[
      if (game is Map) game['appid']?.toString(),
      item['steamAppId']?.toString(),
      item['linkedAppId']?.toString(),
      item['gameId']?.toString(),
      if (game is Map) game['steamAppId']?.toString(),
    ];
    for (final raw in candidates) {
      final id = raw?.trim() ?? '';
      if (RegExp(r'^\d+$').hasMatch(id)) return id;
    }
    return '';
  }

  GameModel _gameModelFromFeedItem(Map<String, dynamic> item) {
    final appid = _resolveSteamAppId(item);
    final game = item['game'];
    final fallbackName = item['gameName']?.toString() ??
        item['title']?.toString() ??
        (appid.isNotEmpty ? 'Game #$appid' : '');
    if (appid.isEmpty) {
      return GameModel(
        appId: '',
        name: fallbackName,
        image: '',
        price: 0,
        originalPrice: 0,
        discount: 0,
      );
    }

    if (game is Map) {
      final g = Map<String, dynamic>.from(game);
      final name = g['name']?.toString() ?? fallbackName;
      final discount = g['discountPercent'] is num
          ? (g['discountPercent'] as num).round()
          : 0;
      var price = 0.0;
      var original = 0.0;
      String? fmtFinal;
      String? fmtInit;
      final ps = g['priceSummary'];
      if (ps is Map) {
        final pmap = Map<String, dynamic>.from(ps);
        final fp = pmap['finalPrice'];
        final op = pmap['originalPrice'];
        var currency = PriceRegionResolver.resolveSync().currency;
        if (pmap['platforms'] is Map) {
          final steam = (pmap['platforms'] as Map)['steam'];
          if (steam is Map) {
            final c = steam['currency']?.toString().trim();
            if (c != null && c.isNotEmpty) currency = c.toUpperCase();
          }
        }
        if (fp is num) {
          price = normalizeDealPriceAmount(fp, currency) ?? fp.toDouble();
        }
        if (op is num) {
          original = normalizeDealPriceAmount(op, currency) ?? op.toDouble();
        } else if (price > 0 && discount > 0) {
          original = price / (1 - discount / 100);
        }
        if (price >= 0) {
          fmtFinal = formatRegionalPrice(amount: price, currency: currency);
          if (discount > 0 && original > price) {
            fmtInit = formatRegionalPrice(amount: original, currency: currency);
          }
        }
      }
      final header = g['headerImage']?.toString().trim() ?? '';
      final image = header.isNotEmpty
          ? header
          : MarketV2Adapter.steamHeaderImage(appid);
      return RecommendedItem(
        steamAppId: appid,
        dealId: appid,
        title: name,
        capsuleImage: image,
        currentPrice: price,
        originalPrice: original > 0 ? original : price,
        discountPercent: discount,
        score: 0,
        reasons: const [],
        tags: const ['video_feed'],
        steamFinalFormatted: fmtFinal,
        steamInitialFormatted: fmtInit,
        priceIsGlobalUsd: false,
        priceSource: 'steam_store',
      ).toGameModel();
    }

    final image = MarketV2Adapter.steamHeaderImage(appid);
    return GameModel(
      appId: appid,
      steamAppID: appid,
      dealID: appid,
      name: fallbackName,
      image: image,
      price: 0,
      originalPrice: 0,
      discount: 0,
      images: [image],
    );
  }

  @override
  void initState() {
    super.initState();
    _loadFeed(initial: true);
  }

  @override
  void dispose() {
    _controller?.dispose();
    _pageController.dispose();
    super.dispose();
  }

  Future<void> _loadFeed({bool initial = false}) async {
    if (!initial && _cursor == null) return;
    try {
      final region = await AppCountryResolver.resolveContext();
      final token = await StorageService.instance.getSteamBackendToken();
      final data = await _backend.getVideoFeed(
        token: token,
        cursor: initial ? null : _cursor,
        country: region.countryCode,
      );
      final raw = data['items'] as List<dynamic>? ?? [];
      final next = raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
      setState(() {
        if (initial) {
          _items = next;
        } else {
          _items = [..._items, ...next];
        }
        _cursor = data['nextCursor']?.toString();
        _loading = false;
        _error = null;
      });
      if (initial) {
        final focusId = widget.initialVideoId?.trim();
        if (focusId != null && focusId.isNotEmpty) {
          await _focusVideo(focusId);
        } else if (_items.isNotEmpty) {
          await _playAt(0);
        }
      }
    } on SteamBackendException catch (e) {
      setState(() {
        _loading = false;
        _error = userFacingError(
          e,
          fallback: AppLocalizations.of(context).get('video_feed_load_failed'),
        );
      });
    } catch (e) {
      setState(() {
        _loading = false;
        _error = userFacingError(
          e,
          fallback: AppLocalizations.of(context).get('video_feed_load_failed'),
        );
      });
    }
  }

  Future<void> _playAt(int index) async {
    if (index < 0 || index >= _items.length) return;
    _currentIndex = index;
    final item = _items[index];
    final videoId = item['videoId']?.toString() ?? '';
    if (videoId.isEmpty) return;
    if (_playbackVideoId == videoId &&
        _controller?.value.isInitialized == true &&
        _playbackError == null) {
      await _controller!.play();
      return;
    }
    await _controller?.dispose();
    _controller = null;
    _playbackVideoId = videoId;
    setState(() {
      _playbackLoading = true;
      _playbackError = null;
      _playbackErrorIndex = null;
    });
    try {
      final variant = item['playbackVariant']?.toString() ?? 'vertical';
      final playback = await _backend.getVideoPlayback(videoId, variant: variant);
      final url = playback['url']?.toString() ?? '';
      if (url.isEmpty) {
        if (!mounted) return;
        setState(() {
          _playbackLoading = false;
          _playbackError =
              AppLocalizations.of(context).get('video_playback_failed');
          _playbackErrorIndex = index;
        });
        return;
      }
      final c = VideoPlayerController.networkUrl(Uri.parse(url));
      await c.initialize();
      await c.setVolume(1.0);
      c.setLooping(true);
      await c.play();
      if (!mounted) {
        await c.dispose();
        return;
      }
      setState(() {
        _controller = c;
        _playbackLoading = false;
        _playbackError = null;
        _playbackErrorIndex = null;
      });
      final token = await StorageService.instance.getSteamBackendToken();
      unawaited(_backend.reportVideoView(videoId, token: token, watchedMs: 1000));
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _playbackLoading = false;
        _playbackError = userFacingError(
          e,
          fallback: AppLocalizations.of(context).get('video_playback_failed'),
        );
        _playbackErrorIndex = index;
      });
    }
  }

  Future<void> _retryPlayback() async {
    final index = _playbackErrorIndex ?? _currentIndex;
    await _playAt(index);
  }

  Future<void> _focusVideo(String videoId) async {
    var index = _items.indexWhere((e) => e['videoId']?.toString() == videoId);
    if (index < 0) {
      try {
        final token = await StorageService.instance.getSteamBackendToken();
        if (token != null && token.isNotEmpty) {
          final region = await AppCountryResolver.resolveContext();
          final liked = await _backend.getMyLikedVideos(token, country: region.countryCode);
          final raw = liked['items'] as List<dynamic>? ?? [];
          for (final e in raw) {
            if (e is! Map) continue;
            final item = Map<String, dynamic>.from(e);
            if (item['videoId']?.toString() == videoId) {
              if (mounted) {
                setState(() => _items = [item, ..._items]);
              }
              index = 0;
              break;
            }
          }
        }
      } catch (_) {}
    }
    if (index < 0 || !mounted) {
      if (_items.isNotEmpty) await _playAt(0);
      return;
    }
    if (_pageController.hasClients) {
      _pageController.jumpToPage(index);
    }
    await _playAt(index);
  }

  Future<void> _toggleLike(Map<String, dynamic> item) async {
    final token = await StorageService.instance.getSteamBackendToken();
    if (token == null || token.isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context).get('sign_in_hint'))),
      );
      return;
    }
    final videoId = item['videoId']?.toString() ?? '';
    if (videoId.isEmpty) return;
    if (_likingVideoId == videoId) return;
    setState(() => _likingVideoId = videoId);
    try {
      final out = await _backend.toggleVideoLike(token, videoId);
      if (!mounted) return;
      setState(() {
        item['engagement'] = {
          ...(item['engagement'] as Map<String, dynamic>? ?? {}),
          'liked': out['liked'] == true,
        };
        final stats = out['stats'];
        if (stats is Map) {
          item['stats'] = Map<String, dynamic>.from(stats);
        }
        _likingVideoId = null;
      });
    } on SteamBackendException catch (e) {
      if (!mounted) return;
      setState(() => _likingVideoId = null);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.message)),
      );
    } catch (e) {
      if (!mounted) return;
      setState(() => _likingVideoId = null);
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(e.toString())),
      );
    }
  }

  Future<void> _openGame(Map<String, dynamic> item) async {
    final appid = _resolveSteamAppId(item);
    if (appid.isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(AppLocalizations.of(context).get('video_game_link_unavailable'))),
      );
      return;
    }
    final game = _gameModelFromFeedItem(item);
    if (!mounted) return;
    await Navigator.of(context).push(
      MaterialPageRoute<void>(builder: (_) => GameDetailPage(game: game)),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    if (_loading && _items.isEmpty) {
      return Scaffold(
        backgroundColor: Colors.black,
        body: Center(child: CircularProgressIndicator(color: AppColors.itadOrange)),
      );
    }
    if (_error != null && _items.isEmpty) {
      return Scaffold(
        backgroundColor: Colors.black,
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Text(
                  _error!,
                  textAlign: TextAlign.center,
                  style: TextStyle(color: Colors.white.withValues(alpha: 0.85)),
                ),
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: () => _loadFeed(initial: true),
                  child: Text(l10n.get('retry')),
                ),
              ],
            ),
          ),
        ),
      );
    }
    if (_items.isEmpty) {
      return Scaffold(
        backgroundColor: Colors.black,
        body: Center(
          child: Text(
            l10n.get('video_feed_empty'),
            style: const TextStyle(color: Colors.white70),
          ),
        ),
      );
    }
    return Scaffold(
      backgroundColor: Colors.black,
      body: PageView.builder(
        controller: _pageController,
        scrollDirection: Axis.vertical,
        itemCount: _items.length,
        onPageChanged: (i) {
          _playAt(i);
          if (i >= _items.length - 2) _loadFeed();
        },
        itemBuilder: (context, index) {
          final item = _items[index];
          final liked = (item['engagement'] as Map?)?['liked'] == true;
          final stats = item['stats'] as Map? ?? {};
          final game = item['game'] as Map?;
          final linkedAppId = _resolveSteamAppId(item);
          final discount = game?['discountPercent'];
          final gameName = game?['name']?.toString() ??
              item['gameName']?.toString() ??
              (linkedAppId.isNotEmpty ? 'App $linkedAppId' : null);
          final hasGameLink = linkedAppId.isNotEmpty || (gameName != null && gameName.trim().isNotEmpty);
          String? steamPriceLabel;
          if (game != null && game['priceSummary'] is Map) {
            final ps = Map<String, dynamic>.from(game['priceSummary'] as Map);
            final fp = ps['finalPrice'];
            var currency = PriceRegionResolver.resolveSync().currency;
            if (ps['platforms'] is Map) {
              final steam = (ps['platforms'] as Map)['steam'];
              if (steam is Map) {
                final c = steam['currency']?.toString().trim();
                if (c != null && c.isNotEmpty) currency = c.toUpperCase();
              }
            }
            if (fp is num && fp >= 0) {
              steamPriceLabel = formatRegionalPrice(
                amount: fp.toDouble(),
                currency: currency,
              );
            }
          }
          return Stack(
            fit: StackFit.expand,
            children: [
              if (index == _currentIndex &&
                  _controller?.value.isInitialized == true &&
                  _playbackError == null)
                FittedBox(
                  fit: BoxFit.cover,
                  child: SizedBox(
                    width: _controller!.value.size.width,
                    height: _controller!.value.size.height,
                    child: VideoPlayer(_controller!),
                  ),
                )
              else if (index == _currentIndex && _playbackLoading)
                Center(
                  child: CircularProgressIndicator(color: AppColors.itadOrange),
                )
              else if (index == _currentIndex && _playbackError != null)
                Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Text(
                          _playbackError!,
                          textAlign: TextAlign.center,
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.9),
                          ),
                        ),
                        const SizedBox(height: 16),
                        FilledButton(
                          onPressed: _retryPlayback,
                          child: Text(l10n.get('retry')),
                        ),
                      ],
                    ),
                  ),
                )
              else
                const ColoredBox(color: Colors.black),
              Positioned(
                right: 12,
                bottom: 120,
                child: Column(
                  children: [
                    IconButton(
                      onPressed: _likingVideoId == item['videoId']?.toString()
                          ? null
                          : () => _toggleLike(item),
                      icon: Icon(
                        liked ? Icons.favorite : Icons.favorite_border,
                        color: liked ? AppColors.itadOrange : Colors.white,
                        size: 32,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                      decoration: BoxDecoration(
                        color: Colors.black.withValues(alpha: 0.55),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Text(
                        l10n.get('video_like_count').replaceAll(
                              '{n}',
                              '${stats['likeCount'] ?? 0}',
                            ),
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    if (hasGameLink)
                      IconButton(
                        onPressed: () => _openGame(item),
                        icon: const Icon(Icons.local_offer, color: Colors.white, size: 32),
                      ),
                  ],
                ),
              ),
              Positioned(
                left: 16,
                right: 72,
                bottom: 48,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      item['title']?.toString() ?? '',
                      style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold),
                    ),
                    if (hasGameLink) ...[
                      const SizedBox(height: 8),
                      GestureDetector(
                        onTap: () => _openGame(item),
                        child: Text(
                          gameName ?? 'App $linkedAppId',
                          style: const TextStyle(
                            color: AppColors.itadOrange,
                            fontSize: 16,
                            fontWeight: FontWeight.w700,
                            decoration: TextDecoration.underline,
                            decorationColor: AppColors.itadOrange,
                          ),
                        ),
                      ),
                      if (steamPriceLabel != null) ...[
                        const SizedBox(height: 6),
                        Text(
                          '${l10n.get('video_steam_price_label')}: $steamPriceLabel',
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 14,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ],
                      if (discount is num && discount > 0)
                        Padding(
                          padding: const EdgeInsets.only(top: 6),
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: AppColors.itadOrange,
                              borderRadius: BorderRadius.circular(6),
                            ),
                            child: Text(
                              '-${discount.round()}%',
                              style: const TextStyle(color: Colors.white),
                            ),
                          ),
                        ),
                      const SizedBox(height: 6),
                      GestureDetector(
                        onTap: () => _openGame(item),
                        child: Text(
                          l10n.get('video_surprise_deals_hint'),
                          style: TextStyle(
                            color: Colors.white.withValues(alpha: 0.72),
                            fontSize: 12,
                            height: 1.35,
                            decoration: TextDecoration.underline,
                            decorationColor:
                                Colors.white.withValues(alpha: 0.45),
                          ),
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}
