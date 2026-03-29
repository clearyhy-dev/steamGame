import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../core/constants/api_constants.dart';

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
        _baseUrl = baseUrl ?? ApiConstants.baseUrl;

  Uri _uri(String path) => Uri.parse('$_baseUrl$path');

  Future<T> _parseData<T>(http.Response response) async {
    if (response.body.isEmpty) throw SteamBackendException(code: 'INTERNAL_ERROR', message: 'Empty response body');

    final map = jsonDecode(response.body) as Map<String, dynamic>;
    if (map['success'] == true) {
      return map['data'] as T;
    }

    final err = map['error'] as Map<String, dynamic>? ?? {};
    final code = (err['code'] ?? 'INTERNAL_ERROR').toString();
    final message = (err['message'] ?? 'Request failed').toString();
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

  void dispose() {
    _client.close();
  }
}

