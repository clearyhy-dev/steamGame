import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../core/app_country_resolver.dart';
import '../../core/storage_service.dart';
import '../../core/theme/colors.dart';
import '../../l10n/app_localizations.dart';
import '../../services/steam_backend_service.dart';
import 'video_feed_page.dart';

class LikedVideosPage extends StatefulWidget {
  const LikedVideosPage({super.key});

  @override
  State<LikedVideosPage> createState() => _LikedVideosPageState();
}

class _LikedVideosPageState extends State<LikedVideosPage> {
  final SteamBackendService _backend = SteamBackendService();
  List<Map<String, dynamic>> _items = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final token = await StorageService.instance.getSteamBackendToken();
      if (token == null || token.isEmpty) {
        setState(() {
          _loading = false;
          _error = 'login_required';
        });
        return;
      }
      final region = await AppCountryResolver.resolveContext();
      final data = await _backend.getMyLikedVideos(
        token,
        country: region.countryCode,
      );
      final raw = data['items'] as List<dynamic>? ?? [];
      setState(() {
        _items = raw.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
        _loading = false;
      });
    } on SteamBackendException catch (e) {
      setState(() {
        _loading = false;
        _error = e.message;
      });
    } catch (e) {
      setState(() {
        _loading = false;
        _error = e.toString();
      });
    }
  }

  void _openVideo(Map<String, dynamic> item) {
    final videoId = item['videoId']?.toString() ?? '';
    if (videoId.isEmpty) return;
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => VideoFeedPage(initialVideoId: videoId),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Scaffold(
      backgroundColor: AppColors.background,
      appBar: AppBar(
        title: Text(l10n.get('profile_liked_videos')),
        backgroundColor: Colors.transparent,
        elevation: 0,
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator(color: AppColors.itadOrange))
          : _error == 'login_required'
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Text(
                      l10n.get('sign_in_hint'),
                      textAlign: TextAlign.center,
                      style: const TextStyle(color: AppColors.textSecondary),
                    ),
                  ),
                )
              : _error != null
                  ? Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Text(_error!, style: const TextStyle(color: AppColors.textSecondary)),
                          TextButton(onPressed: _load, child: Text(l10n.get('retry'))),
                        ],
                      ),
                    )
                  : _items.isEmpty
                      ? Center(
                          child: Text(
                            l10n.get('profile_liked_videos_empty'),
                            style: const TextStyle(color: AppColors.textSecondary),
                          ),
                        )
                      : RefreshIndicator(
                          onRefresh: _load,
                          color: AppColors.itadOrange,
                          child: ListView.separated(
                            padding: const EdgeInsets.all(16),
                            itemCount: _items.length,
                            separatorBuilder: (_, __) => const SizedBox(height: 12),
                            itemBuilder: (context, index) {
                              final item = _items[index];
                              final stats = item['stats'] as Map? ?? {};
                              final likeCount = stats['likeCount'] ?? 0;
                              final thumb = item['thumbnailUrl']?.toString() ?? '';
                              final gameName = item['gameName']?.toString() ??
                                  (item['game'] is Map
                                      ? (item['game'] as Map)['name']?.toString()
                                      : null);
                              return Card(
                                clipBehavior: Clip.antiAlias,
                                child: InkWell(
                                  onTap: () => _openVideo(item),
                                  child: Row(
                                    children: [
                                      SizedBox(
                                        width: 96,
                                        height: 128,
                                        child: thumb.isNotEmpty
                                            ? CachedNetworkImage(
                                                imageUrl: thumb,
                                                fit: BoxFit.cover,
                                              )
                                            : ColoredBox(
                                                color: Colors.black26,
                                                child: Icon(Icons.videocam,
                                                    color: Colors.white.withValues(alpha: 0.5)),
                                              ),
                                      ),
                                      Expanded(
                                        child: Padding(
                                          padding: const EdgeInsets.all(12),
                                          child: Column(
                                            crossAxisAlignment: CrossAxisAlignment.start,
                                            children: [
                                              Text(
                                                item['title']?.toString() ?? item['videoId']?.toString() ?? '',
                                                maxLines: 2,
                                                overflow: TextOverflow.ellipsis,
                                                style: const TextStyle(
                                                  fontWeight: FontWeight.w600,
                                                  fontSize: 15,
                                                ),
                                              ),
                                              if (gameName != null && gameName.isNotEmpty) ...[
                                                const SizedBox(height: 6),
                                                Text(
                                                  gameName,
                                                  maxLines: 1,
                                                  overflow: TextOverflow.ellipsis,
                                                  style: const TextStyle(
                                                    color: AppColors.itadOrange,
                                                    fontSize: 13,
                                                  ),
                                                ),
                                              ],
                                              const SizedBox(height: 8),
                                              Row(
                                                children: [
                                                  const Icon(Icons.favorite,
                                                      size: 16, color: AppColors.itadOrange),
                                                  const SizedBox(width: 4),
                                                  Text(
                                                    l10n.get('video_like_count')
                                                        .replaceAll('{n}', '$likeCount'),
                                                    style: const TextStyle(
                                                      fontSize: 13,
                                                      color: AppColors.textSecondary,
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            ],
                                          ),
                                        ),
                                      ),
                                      const Padding(
                                        padding: EdgeInsets.only(right: 8),
                                        child: Icon(Icons.chevron_right),
                                      ),
                                    ],
                                  ),
                                ),
                              );
                            },
                          ),
                        ),
    );
  }
}
