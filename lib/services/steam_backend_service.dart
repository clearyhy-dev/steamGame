import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/app_remote_config.dart';
import '../core/app_country_resolver.dart';
import '../core/constants/api_constants.dart';
import '../core/storage_service.dart';
import '../core/utils/price_region_resolver.dart';
import '../core/network/backend_client.dart';
import 'market_v2_adapter.dart';

class SteamBackendException implements Exception {
  final String code;
  final String message;
  final dynamic details;

  SteamBackendException({
    required this.code,
    required this.message,
    this.details,
  });

  @override
  String toString() => 'SteamBackendException($code): $message';
}

class SteamBackendService {
  final http.Client _client;
  final String? _baseUrlOverride;
  BackendClient? _backend;
  String? _backendBaseUrl;

  SteamBackendService({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrlOverride = baseUrl;

  String get _baseUrl =>
      _baseUrlOverride ??
      AppRemoteConfig.instance.resolveApiBase(ApiConstants.baseUrl);

  Uri _uri(String path) => Uri.parse('$_baseUrl$path');

  BackendClient get _b => _backend!;

  void _ensureBackendClient() {
    final url = _baseUrl;
    if (_backend == null || _backendBaseUrl != url) {
      _backendBaseUrl = url;
      _backend = BackendClient(client: _client, baseUrl: url);
    }
  }

  /// Logged-in user's server country, else app default country.
  Future<String> resolvePriceCountry() async {
    return (await _resolveCountryCode())?.trim().toUpperCase() ?? 'US';
  }

  Future<http.Response> _requestWithRetry({
    required Future<http.Response> Function() request,
    required Duration timeout,
    required String timeoutMessage,
    int maxAttempts = 3,
  }) async {
    // Preserve existing behavior for callers that rely on retry timing,
    // but route transport through the unified BackendClient implementation.
    _ensureBackendClient();
    SteamBackendException? lastErr;
    for (var i = 0; i < maxAttempts; i++) {
      try {
        final res = await _b.requestWithRetry(
          request: request,
          timeout: timeout,
          timeoutMessage: timeoutMessage,
          maxAttempts: 1,
        );
        return res;
      } on SteamBackendException catch (e) {
        lastErr = e;
      } on TimeoutException {
        lastErr = SteamBackendException(
            code: 'REQUEST_TIMEOUT', message: timeoutMessage);
      } catch (e) {
        lastErr = SteamBackendException(
          code: 'NETWORK_ERROR',
          message: e.toString(),
        );
      }
      if (i < maxAttempts - 1) {
        final backoffMs = 400 * (i + 1) * (i + 1);
        await Future<void>.delayed(Duration(milliseconds: backoffMs));
      }
    }
    throw lastErr ??
        SteamBackendException(
            code: 'INTERNAL_ERROR', message: 'Request failed');
  }

  Future<String?> _resolveCountryCode() async {
    try {
      final token = await StorageService.instance.getSteamBackendToken();
      if (token != null && token.isNotEmpty) {
        try {
          final me = await getMe(token);
          final serverCc = me['countryCode']?.toString().trim().toUpperCase();
          if (serverCc != null && serverCc.length == 2) return serverCc;
        } catch (_) {}
      }
      final selected = (await AppCountryResolver.resolveContext()).countryCode;
      return selected.trim().isEmpty ? 'US' : selected.toUpperCase();
    } catch (_) {
      return 'US';
    }
  }

  /// Aggregated regional detail: market v2 (detail + heat + prices per country).
  Future<Map<String, dynamic>> getGameRegionalDetail(String appid,
      {String? country, String? language}) async {
    final id = appid.trim();
    if (id.isEmpty) {
      throw SteamBackendException(
          code: 'INVALID_APPID', message: 'appid required');
    }
    final cc = (country ?? await _resolveCountryCode())?.trim().toUpperCase() ?? 'US';
    try {
      final v2 = await _fetchMarketV2('/api/v2/markets/$cc/games/$id');
      return MarketV2Adapter.gameResponseToRegionalDetail(v2);
    } on SteamBackendException catch (e) {
      if (e.code != 'NOT_FOUND' && e.code != 'HTTP_404') rethrow;
    } catch (_) {}
    // Legacy fallback when market row not synced yet
    final lang = language ?? await PriceRegionResolver.effectiveSteamUiLanguage();
    final uri = _uri('/api/v1/games/$id/regional-detail').replace(
      queryParameters: {
        'country': cc,
        if (lang.trim().isNotEmpty) 'language': lang.trim().toLowerCase(),
      },
    );
    final res = await _client
        .get(uri, headers: await _authHeaders())
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> getSteamRegionalPrice(String appid) async {
    final id = appid.trim();
    if (id.isEmpty) {
      throw SteamBackendException(code: 'INVALID_APPID', message: 'appid required');
    }
    final country = await _resolveCountryCode();
    final uri = _uri('/api/v1/games/$id/steam-price').replace(
      queryParameters: {
        'country': country ?? 'US',
      },
    );
    final res = await _client
        .get(uri, headers: await _authHeaders())
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, String>> _authHeaders() async {
    final headers = <String, String>{};
    final token = await StorageService.instance.getSteamBackendToken();
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }
    return headers;
  }

  Future<Map<String, dynamic>> _fetchMarketV2(
    String path, {
    Map<String, String>? queryParameters,
  }) async {
    final uri = _uri(path).replace(queryParameters: queryParameters);
    final res = await _client
        .get(uri, headers: await _authHeaders())
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    if (res.statusCode == 404) {
      throw SteamBackendException(code: 'NOT_FOUND', message: 'not_found');
    }
    if (res.body.isEmpty) {
      throw SteamBackendException(
          code: 'INTERNAL_ERROR', message: 'Empty response body');
    }
    final map = jsonDecode(res.body) as Map<String, dynamic>;
    if (map['success'] != true) {
      final err = map['error'];
      final msg = err is Map
          ? (err['message'] ?? err).toString()
          : (err ?? map['message'] ?? 'Request failed').toString();
      throw SteamBackendException(code: 'HTTP_${res.statusCode}', message: msg);
    }
    return map;
  }

  Future<Map<String, dynamic>> _fetchMarketListV2(String cc, String listName) async {
    final cdn = AppRemoteConfig.instance.publicCacheCdnBase;
    if (cdn != null && cdn.isNotEmpty) {
      try {
        final root = cdn.replaceAll(RegExp(r'/+$'), '');
        final uri = Uri.parse('$root/cache/markets/v2/$cc/lists/$listName.json');
        final res = await _client.get(uri).timeout(
          const Duration(seconds: 8),
          onTimeout: () => throw SteamBackendException(
              code: 'REQUEST_TIMEOUT', message: 'CDN cache timeout'),
        );
        if (res.statusCode == 200 && res.body.isNotEmpty) {
          final decoded = jsonDecode(res.body);
          if (decoded is Map<String, dynamic>) {
            final items = decoded['items'];
            if (items is List && items.isNotEmpty) {
              return MarketV2Adapter.itemsPayloadFromMarketRows(
                items,
                countryCode: cc,
                cacheHit: true,
              );
            }
          }
        }
      } catch (_) {}
    }
    final raw = await _fetchMarketV2('/api/v2/markets/$cc/lists/$listName');
    final data = raw['data'];
    if (data is Map<String, dynamic>) {
      final items = data['items'] as List<dynamic>? ?? const [];
      if (items.isNotEmpty) {
        return MarketV2Adapter.itemsPayloadFromMarketRows(items, countryCode: cc);
      }
    }
    final sortBy = listName == 'top-discounts' ? 'discount_desc' : 'heat_desc';
    final games = await _fetchMarketV2('/api/v2/markets/$cc/games', queryParameters: {
      'page': '1',
      'pageSize': '100',
      'sortBy': sortBy,
    });
    final items = games['items'] as List<dynamic>? ?? const [];
    return MarketV2Adapter.itemsPayloadFromMarketRows(items, countryCode: cc);
  }

  Future<T> _parseData<T>(http.Response response) async {
    if (response.body.isEmpty)
      throw SteamBackendException(
          code: 'INTERNAL_ERROR', message: 'Empty response body');

    final trimmed = response.body.trimLeft();
    if (trimmed.startsWith('<!DOCTYPE') ||
        trimmed.startsWith('<html') ||
        trimmed.startsWith('<HTML')) {
      throw SteamBackendException(
        code: 'HTML_RESPONSE',
        message:
            'Server returned HTML (HTTP ${response.statusCode}). Check API base URL or VPN.',
      );
    }

    final Map<String, dynamic> map;
    try {
      map = jsonDecode(response.body) as Map<String, dynamic>;
    } on FormatException catch (e) {
      throw SteamBackendException(
        code: 'INVALID_JSON',
        message: 'Invalid JSON (HTTP ${response.statusCode}): $e',
      );
    }
    if (map['success'] == true || map['ok'] == true) {
      return map['data'] as T;
    }

    final err = map['error'] as Map<String, dynamic>? ?? {};
    final code = (err['code'] ?? 'INTERNAL_ERROR').toString();
    final message =
        (err['message'] ?? map['message'] ?? map['msg'] ?? 'Request failed')
            .toString();
    return Future<T>.error(SteamBackendException(
        code: code, message: message, details: err['details']));
  }

  Future<Map<String, dynamic>> getMe(String token) async {
    final uri = _uri('/api/me');
    final res = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    if (res.statusCode != 200) {
      return _parseData<Map<String, dynamic>>(res);
    }
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> getSteamProfile(String token) async {
    final uri = _uri('/api/me/steam-profile');
    final res = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> patchMe(
    String token, {
    required String countryCode,
    String countrySource = 'manual',
  }) async {
    final uri = _uri('/api/me');
    final body = jsonEncode({
      'countryCode': countryCode,
      'countrySource': countrySource,
    });
    final res = await _client.patch(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: body,
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<void> syncProSubscription(
    String token, {
    required bool isPro,
    int? proUntilMs,
  }) async {
    final uri = _uri('/api/me/subscription');
    final body = jsonEncode({
      'isPro': isPro,
      if (proUntilMs != null) 'proUntilMs': proUntilMs,
    });
    final res = await _client.post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: body,
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> createAppSession({
    required String googleUserId,
    String? email,
    String? displayName,
    String? photoUrl,
  }) async {
    final uri = _uri('/api/auth/app-session');
    final body = jsonEncode({
      'googleUserId': googleUserId,
      if (email != null) 'email': email,
      if (displayName != null) 'displayName': displayName,
      if (photoUrl != null) 'photoUrl': photoUrl,
    });
    final res = await _client
        .post(
          uri,
          headers: {'Content-Type': 'application/json'},
          body: body,
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> migrateFavorites(
    String token,
    List<Map<String, dynamic>> items,
  ) async {
    final uri = _uri('/api/favorites/migrate');
    final res = await _client.post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'items': items}),
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> getFavoritePrices(
    String token, {
    String? country,
  }) async {
    final cc = country ?? await _resolveCountryCode();
    final uri = _uri('/api/me/favorites/prices').replace(
      queryParameters: {
        if (cc != null && cc.isNotEmpty) 'country': cc,
      },
    );
    final res = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> getVideoFeed({
    String? token,
    String? cursor,
    int limit = 10,
    String? country,
  }) async {
    final cc = country ?? await _resolveCountryCode();
    final uri = _uri('/api/videos/feed').replace(queryParameters: {
      if (cursor != null && cursor.isNotEmpty) 'cursor': cursor,
      'limit': '$limit',
      if (cc != null && cc.isNotEmpty) 'country': cc,
    });
    final headers = <String, String>{};
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }
    final res = await _client.get(uri, headers: headers).timeout(
      ApiConstants.receiveTimeout,
      onTimeout: () => throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout'),
    );
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> getVideoPlayback(
    String videoId, {
    String variant = 'vertical',
  }) async {
    final uri = _uri('/api/videos/$videoId/playback').replace(
      queryParameters: {'variant': variant},
    );
    final res = await _client.get(uri).timeout(ApiConstants.receiveTimeout,
        onTimeout: () => throw SteamBackendException(
            code: 'REQUEST_TIMEOUT', message: 'Request timeout'));
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> getMyLikedVideos(
    String token, {
    String? country,
    int limit = 50,
    int offset = 0,
  }) async {
    final cc = country ?? await _resolveCountryCode();
    final uri = _uri('/api/videos/me/likes').replace(queryParameters: {
      'limit': '$limit',
      'offset': '$offset',
      if (cc != null && cc.isNotEmpty) 'country': cc,
    });
    final res = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> toggleVideoLike(String token, String videoId) async {
    final uri = _uri('/api/videos/$videoId/like');
    final res = await _client.post(uri, headers: {'Authorization': 'Bearer $token'}).timeout(
      ApiConstants.receiveTimeout,
      onTimeout: () => throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout'),
    );
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> toggleVideoFavorite(String token, String videoId) async {
    final uri = _uri('/api/videos/$videoId/favorite');
    final res = await _client.post(uri, headers: {'Authorization': 'Bearer $token'});
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> rateVideo(String token, String videoId, int rating) async {
    final uri = _uri('/api/videos/$videoId/rating');
    final res = await _client.post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'rating': rating}),
    );
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<void> reportVideoView(String videoId, {String? token, int watchedMs = 0}) async {
    final uri = _uri('/api/videos/$videoId/view');
    final headers = <String, String>{'Content-Type': 'application/json'};
    if (token != null && token.isNotEmpty) headers['Authorization'] = 'Bearer $token';
    final res = await _client.post(
      uri,
      headers: headers,
      body: jsonEncode({'watchedMs': watchedMs}),
    );
    await _parseData<Map<String, dynamic>>(res);
  }

  Future<List<dynamic>> listFavorites(String token) async {
    final uri = _uri('/api/favorites');
    final res = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    final data = await _parseData<Map<String, dynamic>>(res);
    return (data['favorites'] as List<dynamic>? ?? []);
  }

  Future<void> addFavorite({
    required String token,
    required String appid,
    required String name,
    required String headerImage,
    required String source,
  }) async {
    final uri = _uri('/api/favorites');
    final body = jsonEncode({
      'appid': appid,
      'name': name,
      'headerImage': headerImage,
      'source': source,
    });
    final res = await _client
        .post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json'
      },
      body: body,
    )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    await _parseData<Map<String, dynamic>>(res);
  }

  Future<void> deleteFavorite(
      {required String token, required String appid}) async {
    final uri = _uri('/api/favorites/$appid');
    final res = await _client.delete(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    await _parseData<Map<String, dynamic>>(res);
  }

  Future<void> syncSteam(String token) async {
    final uri = _uri('/api/steam/sync');
    final res = await _client.post(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    await _parseData<Map<String, dynamic>>(res);
  }

  Future<void> logout(String token) async {
    final uri = _uri('/auth/logout');
    final res = await _client.post(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    await _parseData<Map<String, dynamic>>(res);
  }

  Future<List<dynamic>> getOwnedGames(String token) async {
    final uri = _uri('/api/steam/games/owned');
    final res = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    final data = await _parseData<Map<String, dynamic>>(res);
    return (data['games'] as List<dynamic>? ?? []);
  }

  Future<List<dynamic>> getRecentGames(String token) async {
    final uri = _uri('/api/steam/games/recent');
    final res = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    final data = await _parseData<Map<String, dynamic>>(res);
    return (data['games'] as List<dynamic>? ?? []);
  }

  Future<List<dynamic>> getFriendsStatus(String token) async {
    final uri = _uri('/api/steam/friends/status');
    final res = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    final data = await _parseData<Map<String, dynamic>>(res);
    return (data['friends'] as List<dynamic>? ?? []);
  }

  Future<Map<String, dynamic>> getWishlistDecisions(String token,
      {String? country}) async {
    final resolvedCountry =
        (country ?? await _resolveCountryCode())?.trim().toUpperCase();
    final uri = _uri('/v1/wishlist/decisions').replace(
      queryParameters: resolvedCountry != null && resolvedCountry.isNotEmpty
          ? {'country': resolvedCountry}
          : null,
    );
    final res = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> getStatsSummary(String token) async {
    final uri = _uri('/v1/stats/summary');
    final res = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> getShareCard(String token) async {
    final uri = _uri('/v1/stats/share-card');
    final res = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> getExploreRecommendations(String token,
      {required String tab, String? country, String? language}) async {
    final resolvedCountry =
        (country ?? await _resolveCountryCode())?.trim().toUpperCase() ?? 'US';
    try {
      final listName = MarketV2Adapter.listNameForExploreTab(tab);
      return await _fetchMarketListV2(resolvedCountry, listName);
    } catch (_) {}
    final resolvedLang =
        language ?? await PriceRegionResolver.effectiveSteamUiLanguage();
    final uri = _uri('/v1/recommendations/explore').replace(
      queryParameters: {
        'tab': tab,
        'country': resolvedCountry,
        if (resolvedLang.trim().isNotEmpty) 'language': resolvedLang.trim().toLowerCase(),
      },
    );
    final res = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<void> postAnalyticsEvent(
      String token, String path, Map<String, dynamic> body) async {
    final uri = _uri('/v1/events/$path');
    final res = await _client
        .post(
      uri,
      headers: {
        'Authorization': 'Bearer $token',
        'Content-Type': 'application/json'
      },
      body: jsonEncode(body),
    )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    await _parseData<Map<String, dynamic>>(res);
  }

  /// 无需登录：分国 market v2 榜单（CDN → API list → API games）。
  Future<Map<String, dynamic>> getTrendingPublicRecommendations(
      {String? country, String? language}) async {
    final resolvedCountry =
        (country ?? await _resolveCountryCode())?.trim().toUpperCase() ?? 'US';
    final resolvedLang =
        language ?? await PriceRegionResolver.effectiveSteamUiLanguage();
    try {
      final out = await _fetchMarketListV2(resolvedCountry, 'top-discounts');
      final meta = (out['meta'] as Map<String, dynamic>?) ?? {};
      meta['effectiveLanguage'] =
          resolvedLang.trim().isNotEmpty ? resolvedLang.trim().toLowerCase() : 'en';
      out['meta'] = meta;
      return out;
    } catch (_) {}

    final cdn = AppRemoteConfig.instance.publicCacheCdnBase;
    if (cdn != null && cdn.isNotEmpty) {
      try {
        final snap = await _fetchTrendingSnapshotFromCdn(
          cdnBase: cdn,
          effectiveCountry: resolvedCountry,
          effectiveLanguage: resolvedLang.trim().toLowerCase(),
        );
        if (snap != null) return snap;
      } catch (_) {}
    }

    final uri = _uri('/v1/recommendations/trending-public').replace(
      queryParameters: {
        'country': resolvedCountry,
        if (resolvedLang.trim().isNotEmpty) 'language': resolvedLang.trim().toLowerCase(),
      },
    );
    final res = await _client.get(uri).timeout(ApiConstants.receiveTimeout,
        onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  /// GCS `cache/trending-games.json` 为轻量快照；映射为与 [getTrendingPublicRecommendations] API `data` 相同的 `items` 形态。
  Future<Map<String, dynamic>?> _fetchTrendingSnapshotFromCdn({
    required String cdnBase,
    required String effectiveCountry,
    required String effectiveLanguage,
  }) async {
    final root = cdnBase.replaceAll(RegExp(r'/+$'), '');
    final uri = Uri.parse('$root/cache/trending-games.json');
    final res = await _client.get(uri).timeout(
      const Duration(seconds: 8),
      onTimeout: () => throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'CDN cache timeout'),
    );
    if (res.statusCode != 200 || res.body.isEmpty) return null;
    final decoded = jsonDecode(res.body);
    if (decoded is! Map<String, dynamic>) return null;
    final rawItems = decoded['items'];
    if (rawItems is! List<dynamic>) return null;
    final items = <Map<String, dynamic>>[];
    for (final e in rawItems) {
      if (e is! Map) continue;
      final m = Map<String, dynamic>.from(e);
      final appid = (m['appid'] ?? m['steamAppId'])?.toString().trim() ?? '';
      if (appid.isEmpty) continue;
      final title = (m['name'] ?? m['title'])?.toString() ?? '';
      final cap = m['capsuleImage']?.toString() ?? '';
      final disc = _numInt(m['discountPercent']);
      final players = _numDouble(m['currentPlayers']);
      final score = disc + (players / 10000).clamp(0, 10);
      items.add({
        'steamAppId': appid,
        'dealId': appid,
        'title': title,
        'capsuleImage': cap,
        'currentPrice': 0.0,
        'originalPrice': 0.0,
        'discountPercent': disc,
        'score': score,
        'reasons': <String>[],
        'tags': <String>['popular_now'],
        'priceIsGlobalUsd': true,
      });
    }
    if (items.isEmpty) return null;
    final generatedAt = decoded['generatedAt']?.toString() ?? '';
    return {
      'items': items,
      'meta': {
        'steamLinked': false,
        'effectiveCountry': effectiveCountry,
        'effectiveLanguage':
            effectiveLanguage.isNotEmpty ? effectiveLanguage : 'en',
        'countrySource': 'app_country',
        'generatedAt': generatedAt,
        'cacheHit': true,
      },
    };
  }

  static int _numInt(dynamic v) {
    if (v is int) return v;
    if (v is num) return v.round();
    return int.tryParse(v?.toString() ?? '') ?? 0;
  }

  static double _numDouble(dynamic v) {
    if (v is num) return v.toDouble();
    return double.tryParse(v?.toString() ?? '') ?? 0;
  }

  /// 首页推荐：优先 market v2 top-heat；登录态仍可用 v1 个性化作补充。
  Future<Map<String, dynamic>> getHomeRecommendations(String token,
      {String? country, String? language}) async {
    final resolvedCountry =
        (country ?? await _resolveCountryCode())?.trim().toUpperCase() ?? 'US';
    final resolvedLang =
        language ?? await PriceRegionResolver.effectiveSteamUiLanguage();
    try {
      final out = await _fetchMarketListV2(resolvedCountry, 'top-heat');
      final items = out['items'] as List<dynamic>? ?? const [];
      if (items.isNotEmpty) {
        final meta = (out['meta'] as Map<String, dynamic>?) ?? {};
        meta['effectiveLanguage'] =
            resolvedLang.trim().isNotEmpty ? resolvedLang.trim().toLowerCase() : 'en';
        out['meta'] = meta;
        return out;
      }
    } catch (_) {}
    final uri = _uri('/v1/recommendations/home').replace(
      queryParameters: {
        'country': resolvedCountry,
        if (resolvedLang.trim().isNotEmpty) 'language': resolvedLang.trim().toLowerCase(),
      },
    );
    final res = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  /// 聚合：资料、扩展字段、拥有/最近/好友、应用内收藏（一次请求）。
  Future<Map<String, dynamic>> getSteamOverview(String token,
      {String? country}) async {
    final resolvedCountry =
        (country ?? await _resolveCountryCode())?.trim().toUpperCase();
    final uri = _uri('/api/steam/overview').replace(
      queryParameters: resolvedCountry != null && resolvedCountry.isNotEmpty
          ? {'country': resolvedCountry}
          : null,
    );
    final res = await _client.get(
      uri,
      headers: {'Authorization': 'Bearer $token'},
    ).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<String> getGameDiscountLink(String appid, {String? country}) async {
    final id = appid.trim();
    if (id.isEmpty) return '';
    final selectedCountry =
        (country ?? await _resolveCountryCode())?.trim().toUpperCase();
    final uri = _uri('/api/games/$id/discount-link').replace(
      queryParameters: selectedCountry != null && selectedCountry.isNotEmpty
          ? {'country': selectedCountry}
          : null,
    );
    final res = await _client
        .get(uri, headers: await _authHeaders())
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    final data = await _parseData<Map<String, dynamic>>(res);
    return (data['discountUrl'] ?? '').toString();
  }

  Future<Map<String, dynamic>> getGameDeals(String appid,
      {String? country}) async {
    final id = appid.trim();
    if (id.isEmpty) return <String, dynamic>{'links': <dynamic>[]};
    final selectedCountry = ((country ?? await _resolveCountryCode()) ?? 'AUTO')
        .trim()
        .toUpperCase();
    // Helps diagnose mismatch between selected region and backend deals scope.
    // ignore: avoid_print
    print(
        'SteamBackendService.getGameDeals appid=$id country=$selectedCountry');
    final uri = _uri('/api/games/$id/deals').replace(
      queryParameters: selectedCountry.isNotEmpty && selectedCountry != 'AUTO'
          ? {'country': selectedCountry}
          : null,
    );
    final headers = await _authHeaders();
    try {
      final res = await _requestWithRetry(
        request: () => _client.get(uri, headers: headers),
        timeout: const Duration(seconds: 25),
        timeoutMessage: 'Deals request timeout',
        maxAttempts: 3,
      );
      return _parseData<Map<String, dynamic>>(res);
    } catch (e) {
      if (headers.containsKey('Authorization')) {
        // Public deals endpoint should work without auth; retry anonymous if token payload fails.
        final res = await _requestWithRetry(
          request: () => _client.get(uri),
          timeout: const Duration(seconds: 25),
          timeoutMessage: 'Deals request timeout',
          maxAttempts: 2,
        );
        return _parseData<Map<String, dynamic>>(res);
      }
      rethrow;
    }
  }

  Future<void> ensureGameMeta(String appid) async {
    final id = appid.trim();
    if (id.isEmpty) return;
    final uri = _uri('/api/games/$id/ensure-meta');
    final res = await _client
        .post(uri, headers: await _authHeaders())
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(
          code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    await _parseData<Map<String, dynamic>>(res);
  }

  Future<void> refreshGameDeals(String appid, {String? country}) async {
    final id = appid.trim();
    if (id.isEmpty) return;
    final selectedCountry = ((country ?? await _resolveCountryCode()) ?? 'US')
        .trim()
        .toUpperCase();
    final uri = _uri('/api/v2/markets/$selectedCountry/games/$id/refresh');
    final headers = await _authHeaders();
    try {
      final res = await _requestWithRetry(
        request: () => _client.post(uri, headers: headers),
        timeout: const Duration(seconds: 120),
        timeoutMessage: 'Refresh market game timeout',
        maxAttempts: 2,
      );
      final map = jsonDecode(res.body) as Map<String, dynamic>;
      if (map['success'] == true) return;
    } catch (_) {}
    // Legacy fallback
    final legacyUri = _uri('/api/games/$id/refresh-deals').replace(
      queryParameters: {'country': selectedCountry},
    );
    final res = await _requestWithRetry(
      request: () => _client.post(legacyUri, headers: headers),
      timeout: const Duration(seconds: 60),
      timeoutMessage: 'Refresh deals timeout',
      maxAttempts: 3,
    );
    await _parseData<Map<String, dynamic>>(res);
  }

  void dispose() {
    _client.close();
  }
}
