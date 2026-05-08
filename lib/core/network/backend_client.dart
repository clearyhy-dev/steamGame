import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

import '../app_remote_config.dart';
import '../constants/api_constants.dart';
import '../storage_service.dart';

class BackendException implements Exception {
  final int statusCode;
  final String code;
  final String message;
  final dynamic details;

  BackendException({
    required this.statusCode,
    required this.code,
    required this.message,
    this.details,
  });

  @override
  String toString() => 'BackendException($statusCode/$code): $message';
}

/// Unified HTTP client for our backend.
///
/// - Single baseUrl resolution (`AppRemoteConfig` override on top of compile-time default)
/// - Consistent timeout and retry policy
/// - Consistent response envelope parsing (`success/ok` + `data/error`)
/// - Consistent auth header injection (Bearer token from `StorageService.getSteamBackendToken`)
class BackendClient {
  BackendClient({http.Client? client, String? baseUrl})
      : _client = client ?? http.Client(),
        _baseUrl = (baseUrl ??
                AppRemoteConfig.instance.resolveApiBase(ApiConstants.baseUrl))
            .replaceAll(RegExp(r'/+$'), '');

  final http.Client _client;
  final String _baseUrl;

  Uri uri(String path, {Map<String, String>? query}) {
    final u = Uri.parse('$_baseUrl$path');
    if (query == null || query.isEmpty) return u;
    return u.replace(queryParameters: query);
  }

  Future<Map<String, String>> _authHeaders({bool includeAuth = true}) async {
    final headers = <String, String>{'Content-Type': 'application/json'};
    if (!includeAuth) return headers;
    final token = await StorageService.instance.getSteamBackendToken();
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }
    return headers;
  }

  Future<http.Response> requestWithRetry({
    required Future<http.Response> Function() request,
    required Duration timeout,
    required String timeoutMessage,
    int maxAttempts = 3,
  }) async {
    BackendException? lastErr;
    for (var i = 0; i < maxAttempts; i++) {
      try {
        return await request().timeout(timeout, onTimeout: () {
          throw BackendException(
            statusCode: 408,
            code: 'REQUEST_TIMEOUT',
            message: timeoutMessage,
          );
        });
      } on BackendException catch (e) {
        lastErr = e;
      } on TimeoutException {
        lastErr = BackendException(
          statusCode: 408,
          code: 'REQUEST_TIMEOUT',
          message: timeoutMessage,
        );
      } catch (e) {
        lastErr = BackendException(
          statusCode: 0,
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
        BackendException(statusCode: 500, code: 'INTERNAL_ERROR', message: 'Request failed');
  }

  Future<Map<String, dynamic>> get(
    String path, {
    Map<String, String>? query,
    bool includeAuth = true,
    Duration? timeout,
    int maxAttempts = 2,
  }) async {
    final headers = await _authHeaders(includeAuth: includeAuth);
    final res = await requestWithRetry(
      request: () => _client.get(uri(path, query: query), headers: headers),
      timeout: timeout ?? ApiConstants.receiveTimeout,
      timeoutMessage: 'Request timeout',
      maxAttempts: maxAttempts,
    );
    return decodeEnvelope(res);
  }

  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic>? body,
    Map<String, String>? query,
    bool includeAuth = true,
    Duration? timeout,
    int maxAttempts = 2,
  }) async {
    final headers = await _authHeaders(includeAuth: includeAuth);
    final res = await requestWithRetry(
      request: () => _client.post(
        uri(path, query: query),
        headers: headers,
        body: jsonEncode(body ?? const <String, dynamic>{}),
      ),
      timeout: timeout ?? ApiConstants.receiveTimeout,
      timeoutMessage: 'Request timeout',
      maxAttempts: maxAttempts,
    );
    return decodeEnvelope(res);
  }

  Future<Map<String, dynamic>> delete(
    String path, {
    Map<String, String>? query,
    bool includeAuth = true,
    Duration? timeout,
    int maxAttempts = 2,
  }) async {
    final headers = await _authHeaders(includeAuth: includeAuth);
    final res = await requestWithRetry(
      request: () => _client.delete(uri(path, query: query), headers: headers),
      timeout: timeout ?? ApiConstants.receiveTimeout,
      timeoutMessage: 'Request timeout',
      maxAttempts: maxAttempts,
    );
    return decodeEnvelope(res);
  }

  Map<String, dynamic> decodeEnvelope(http.Response res) {
    final body = res.body.isEmpty ? <String, dynamic>{} : (jsonDecode(res.body) as Map<String, dynamic>);
    final ok = body['success'] == true || body['ok'] == true;
    if (ok) {
      final data = body['data'];
      if (data is Map) return data.cast<String, dynamic>();
      return <String, dynamic>{'value': data};
    }
    final err = (body['error'] as Map?)?.cast<String, dynamic>() ?? {};
    final code = (err['code'] ?? body['code'] ?? 'INTERNAL_ERROR').toString();
    final message = (err['message'] ?? body['message'] ?? body['msg'] ?? 'Request failed').toString();
    throw BackendException(statusCode: res.statusCode, code: code, message: message, details: err['details']);
  }
}

