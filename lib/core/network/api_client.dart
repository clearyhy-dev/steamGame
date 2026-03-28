import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../config/app_config.dart';
import '../storage/token_storage.dart';
import 'auth_interceptor.dart';

class ApiException implements Exception {
  final int statusCode;
  final String code;
  final String message;
  final dynamic details;

  ApiException({
    required this.statusCode,
    required this.code,
    required this.message,
    this.details,
  });

  @override
  String toString() => 'ApiException($statusCode/$code): $message';
}

class ApiClient {
  ApiClient({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrl = baseUrl ?? AppConfig.apiBaseUrl;

  final http.Client _client;
  final String _baseUrl;
  final AuthInterceptor _authInterceptor = AuthInterceptor();

  Duration timeout = const Duration(seconds: 20);

  Uri _uri(String path, [Map<String, String>? query]) {
    final u = Uri.parse('$_baseUrl$path');
    if (query == null || query.isEmpty) return u;
    return u.replace(queryParameters: query);
  }

  Future<Map<String, dynamic>> get(String path, {Map<String, String>? query, bool includeAuth = true}) async {
    final headers = await _authInterceptor.buildHeaders(includeAuth: includeAuth);
    final res = await _client.get(_uri(path, query), headers: headers).timeout(timeout, onTimeout: () {
      throw ApiException(statusCode: 408, code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _decode(res);
  }

  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic>? body,
    bool includeAuth = true,
  }) async {
    final headers = await _authInterceptor.buildHeaders(includeAuth: includeAuth);
    final res = await _client
        .post(_uri(path), headers: headers, body: jsonEncode(body ?? {}))
        .timeout(timeout, onTimeout: () {
      throw ApiException(statusCode: 408, code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _decode(res);
  }

  Future<Map<String, dynamic>> delete(String path, {bool includeAuth = true}) async {
    final headers = await _authInterceptor.buildHeaders(includeAuth: includeAuth);
    final res = await _client.delete(_uri(path), headers: headers).timeout(timeout, onTimeout: () {
      throw ApiException(statusCode: 408, code: 'REQUEST_TIMEOUT', message: 'Request timeout');
    });
    return _decode(res);
  }

  Map<String, dynamic> _decode(http.Response res) {
    final body = res.body.isEmpty ? <String, dynamic>{} : (jsonDecode(res.body) as Map<String, dynamic>);
    if (res.statusCode == 401) {
      // token 失效自动清理
      unawaited(TokenStorage.instance.clearJwt());
      throw ApiException(statusCode: 401, code: 'JWT_INVALID', message: 'Token expired or invalid');
    }
    if (body['success'] == true) {
      return (body['data'] as Map?)?.cast<String, dynamic>() ?? <String, dynamic>{};
    }
    final error = (body['error'] as Map?)?.cast<String, dynamic>() ?? {};
    throw ApiException(
      statusCode: res.statusCode,
      code: (error['code'] ?? 'INTERNAL_ERROR').toString(),
      message: (error['message'] ?? 'Request failed').toString(),
      details: error['details'],
    );
  }
}

