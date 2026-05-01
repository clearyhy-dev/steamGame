import 'dart:async';
import 'dart:convert';
import 'dart:ui' as ui;

import 'package:http/http.dart' as http;

import '../core/app_remote_config.dart';
import '../core/constants/api_constants.dart';
import '../core/region_config.dart';
import '../core/storage_service.dart';

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
  final String _baseUrl;

  SteamBackendService({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrl = baseUrl ?? AppRemoteConfig.instance.resolveApiBase(ApiConstants.baseUrl);

  Uri _uri(String path) => Uri.parse('$_baseUrl$path');

  Set<String> get _supportedDiscountCountries => AppRemoteConfig.instance.supportedDealCountries.toSet();
  Map<String, String> get _localeToSupportedCountry =>
      AppRemoteConfig.instance.countryMap.map((k, v) => MapEntry(k.toLowerCase(), v.toUpperCase()));

  static final Map<String, String> _localeToCountryFallback = () {
    final m = <String, String>{};
    // Build from full region list so every configured country is covered.
    for (final r in RegionConfig.allRegions) {
      m.putIfAbsent(r.localeCode.toLowerCase(), () => r.id.toUpperCase());
    }
    // Keep deterministic defaults for common ambiguous locales.
    m['en'] = 'US';
    m['pt'] = m['pt'] ?? 'BR';
    m['zh'] = m['zh'] ?? 'CN';
    return m;
  }();

  Future<http.Response> _requestWithRetry({
    required Future<http.Response> Function() request,
    required Duration timeout,
    required String timeoutMessage,
    int maxAttempts = 3,
  }) async {
    SteamBackendException? lastErr;
    for (var i = 0; i < maxAttempts; i++) {
      try {
        return await request().timeout(timeout, onTimeout: () {
          throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: timeoutMessage);
        });
      } on SteamBackendException catch (e) {
        lastErr = e;
      } on TimeoutException {
        lastErr = SteamBackendException(code: 'REQUEST_TIMEOUT', message: timeoutMessage);
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
    throw lastErr ?? SteamBackendException(code: 'INTERNAL_ERROR', message: 'Request failed');
  }

  Future<String?> _resolveCountryCode() async {
    try {
      final candidates = <String>[
        (await StorageService.instance.getPreferredLocale())?.trim() ?? '',
        '${ui.PlatformDispatcher.instance.locale.languageCode}_${ui.PlatformDispatcher.instance.locale.countryCode ?? ''}'.trim(),
        ui.PlatformDispatcher.instance.locale.toLanguageTag().trim(),
      ];
      for (final raw in candidates) {
        if (raw.isEmpty) continue;
        // New format: region id (e.g. JP/US/CN).
        final direct = raw.toUpperCase();
        if (RegionConfig.isRegionId(direct)) {
          final mapped = _mapToSupportedCountry(direct);
          if (mapped != null) return mapped;
        }

        // Locale-like inputs, e.g. ja / ja_JP / ja-JP / en_US.
        final normalized = raw.replaceAll('-', '_');
        final parts = normalized.split('_').where((e) => e.isNotEmpty).toList();
        if (parts.length >= 2) {
          final countryPart = parts[1].toUpperCase();
          if (RegionConfig.isRegionId(countryPart)) {
            final mapped = _mapToSupportedCountry(countryPart);
            if (mapped != null) return mapped;
          }
        }
        final localePart = (parts.isNotEmpty ? parts.first : raw).toLowerCase();
        if (_localeToCountryFallback.containsKey(localePart)) {
          final mapped = _mapToSupportedCountry(_localeToCountryFallback[localePart]!);
          if (mapped != null) return mapped;
        }
        if (raw.length == 2 && RegionConfig.isRegionId(direct)) {
          final mapped = _mapToSupportedCountry(direct);
          if (mapped != null) return mapped;
        }
      }
      return 'US';
    } catch (_) {
      return 'US';
    }
  }

  String? _mapToSupportedCountry(String countryCode) {
    final cc = countryCode.trim().toUpperCase();
    if (cc.isEmpty) return null;
    if (_supportedDiscountCountries.contains(cc)) return cc;
    final region = RegionConfig.allRegions.where((r) => r.id == cc).cast<dynamic>().firstWhere(
      (_) => true,
      orElse: () => null,
    );
    if (region != null) {
      final localeCode = (region.localeCode as String).toLowerCase();
      if (_localeToSupportedCountry.containsKey(localeCode)) {
        return _localeToSupportedCountry[localeCode];
      }
    }
    return 'US';
  }

  Future<Map<String, String>> _authHeaders() async {
    final headers = <String, String>{};
    final token = await StorageService.instance.getSteamBackendToken();
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }
    return headers;
  }

  Future<T> _parseData<T>(http.Response response) async {
    if (response.body.isEmpty) throw SteamBackendException(code: 'INTERNAL_ERROR', message: 'Empty response body');

    final map = jsonDecode(response.body) as Map<String, dynamic>;
    if (map['success'] == true || map['ok'] == true) {
      return map['data'] as T;
    }

    final err = map['error'] as Map<String, dynamic>? ?? {};
    final code = (err['code'] ?? 'INTERNAL_ERROR').toString();
    final message = (err['message'] ?? map['message'] ?? map['msg'] ?? 'Request failed').toString();
    return Future<T>.error(SteamBackendException(code: code, message: message, details: err['details']));
  }

  Future<Map<String, dynamic>> getMe(String token) async {
    final uri = _uri('/api/me');
    final res = await _client
        .get(
          uri,
          headers: {'Authorization': 'Bearer $token'},
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    if (res.statusCode != 200) {
      return _parseData<Map<String, dynamic>>(res);
    }
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> getSteamProfile(String token) async {
    final uri = _uri('/api/me/steam-profile');
    final res = await _client
        .get(
          uri,
          headers: {'Authorization': 'Bearer $token'},
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<List<dynamic>> listFavorites(String token) async {
    final uri = _uri('/api/favorites');
    final res = await _client
        .get(
          uri,
          headers: {'Authorization': 'Bearer $token'},
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
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
          headers: {'Authorization': 'Bearer $token', 'Content-Type': 'application/json'},
          body: body,
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    await _parseData<Map<String, dynamic>>(res);
  }

  Future<void> deleteFavorite({required String token, required String appid}) async {
    final uri = _uri('/api/favorites/$appid');
    final res = await _client
        .delete(
          uri,
          headers: {'Authorization': 'Bearer $token'},
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    await _parseData<Map<String, dynamic>>(res);
  }

  Future<void> syncSteam(String token) async {
    final uri = _uri('/api/steam/sync');
    final res = await _client
        .post(
          uri,
          headers: {'Authorization': 'Bearer $token'},
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    await _parseData<Map<String, dynamic>>(res);
  }

  Future<void> logout(String token) async {
    final uri = _uri('/auth/logout');
    final res = await _client
        .post(
          uri,
          headers: {'Authorization': 'Bearer $token'},
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    await _parseData<Map<String, dynamic>>(res);
  }

  Future<List<dynamic>> getOwnedGames(String token) async {
    final uri = _uri('/api/steam/games/owned');
    final res = await _client
        .get(
          uri,
          headers: {'Authorization': 'Bearer $token'},
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    final data = await _parseData<Map<String, dynamic>>(res);
    return (data['games'] as List<dynamic>? ?? []);
  }

  Future<List<dynamic>> getRecentGames(String token) async {
    final uri = _uri('/api/steam/games/recent');
    final res = await _client
        .get(
          uri,
          headers: {'Authorization': 'Bearer $token'},
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    final data = await _parseData<Map<String, dynamic>>(res);
    return (data['games'] as List<dynamic>? ?? []);
  }

  Future<List<dynamic>> getFriendsStatus(String token) async {
    final uri = _uri('/api/steam/friends/status');
    final res = await _client
        .get(
          uri,
          headers: {'Authorization': 'Bearer $token'},
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    final data = await _parseData<Map<String, dynamic>>(res);
    return (data['friends'] as List<dynamic>? ?? []);
  }

  Future<Map<String, dynamic>> getWishlistDecisions(String token) async {
    final uri = _uri('/v1/wishlist/decisions');
    final res = await _client
        .get(
          uri,
          headers: {'Authorization': 'Bearer $token'},
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> getStatsSummary(String token) async {
    final uri = _uri('/v1/stats/summary');
    final res = await _client
        .get(
          uri,
          headers: {'Authorization': 'Bearer $token'},
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> getShareCard(String token) async {
    final uri = _uri('/v1/stats/share-card');
    final res = await _client
        .get(
          uri,
          headers: {'Authorization': 'Bearer $token'},
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<Map<String, dynamic>> getExploreRecommendations(String token, {required String tab}) async {
    final uri = _uri('/v1/recommendations/explore').replace(queryParameters: {'tab': tab});
    final res = await _client
        .get(
          uri,
          headers: {'Authorization': 'Bearer $token'},
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<void> postAnalyticsEvent(String token, String path, Map<String, dynamic> body) async {
    final uri = _uri('/v1/events/$path');
    final res = await _client
        .post(
          uri,
          headers: {'Authorization': 'Bearer $token', 'Content-Type': 'application/json'},
          body: jsonEncode(body),
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    await _parseData<Map<String, dynamic>>(res);
  }

  /// 个性化首页推荐（规则打分 + CheapShark 池）。
  Future<Map<String, dynamic>> getHomeRecommendations(String token) async {
    final uri = _uri('/v1/recommendations/home');
    final res = await _client
        .get(
          uri,
          headers: {'Authorization': 'Bearer $token'},
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  /// 聚合：资料、扩展字段、拥有/最近/好友、应用内收藏（一次请求）。
  Future<Map<String, dynamic>> getSteamOverview(String token) async {
    final uri = _uri('/api/steam/overview');
    final res = await _client
        .get(
          uri,
          headers: {'Authorization': 'Bearer $token'},
        )
        .timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _parseData<Map<String, dynamic>>(res);
  }

  Future<String> getGameDiscountLink(String appid) async {
    final id = appid.trim();
    if (id.isEmpty) return '';
    final country = await _resolveCountryCode();
    final uri = _uri('/api/games/$id/discount-link').replace(
      queryParameters: country != null ? {'country': country} : null,
    );
    final res = await _client.get(uri, headers: await _authHeaders()).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    final data = await _parseData<Map<String, dynamic>>(res);
    return (data['discountUrl'] ?? '').toString();
  }

  Future<Map<String, dynamic>> getGameDeals(String appid) async {
    final id = appid.trim();
    if (id.isEmpty) return <String, dynamic>{'links': <dynamic>[]};
    final country = await _resolveCountryCode();
    final selectedCountry = country ?? 'AUTO';
    // Helps diagnose mismatch between selected region and backend deals scope.
    // ignore: avoid_print
    print('SteamBackendService.getGameDeals appid=$id country=$selectedCountry');
    final uri = _uri('/api/games/$id/deals').replace(
      queryParameters: country != null ? {'country': country} : null,
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
    final res = await _client.post(uri, headers: await _authHeaders()).timeout(ApiConstants.receiveTimeout, onTimeout: () {
      throw SteamBackendException(code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    await _parseData<Map<String, dynamic>>(res);
  }

  Future<void> refreshGameDeals(String appid) async {
    final id = appid.trim();
    if (id.isEmpty) return;
    final country = await _resolveCountryCode();
    final selectedCountry = country ?? 'AUTO';
    // ignore: avoid_print
    print('SteamBackendService.refreshGameDeals appid=$id country=$selectedCountry');
    final uri = _uri('/api/games/$id/refresh-deals').replace(
      queryParameters: country != null ? {'country': country} : null,
    );
    final headers = await _authHeaders();
    final res = await _requestWithRetry(
      request: () => _client.post(uri, headers: headers),
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

