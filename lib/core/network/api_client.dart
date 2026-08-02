import 'dart:async';

import 'package:http/http.dart' as http;

import '../storage/token_storage.dart';
import 'backend_client.dart';

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
      : _backend = BackendClient(client: client, baseUrl: baseUrl);

  final BackendClient _backend;

  Duration timeout = const Duration(seconds: 20);

  Future<Map<String, dynamic>> get(String path, {Map<String, String>? query, bool includeAuth = true}) async {
    try {
      return await _backend.get(
        path,
        query: query,
        includeAuth: includeAuth,
        timeout: timeout,
        maxAttempts: 1,
      );
    } on BackendException catch (e) {
      _handleMaybeInvalidJwt(e);
      throw ApiException(statusCode: e.statusCode, code: e.code, message: e.message, details: e.details);
    }
  }

  Future<Map<String, dynamic>> post(
    String path, {
    Map<String, dynamic>? body,
    bool includeAuth = true,
  }) async {
    try {
      return await _backend.post(
        path,
        body: body,
        includeAuth: includeAuth,
        timeout: timeout,
        maxAttempts: 1,
      );
    } on BackendException catch (e) {
      _handleMaybeInvalidJwt(e);
      throw ApiException(statusCode: e.statusCode, code: e.code, message: e.message, details: e.details);
    }
  }

  Future<Map<String, dynamic>> delete(String path, {bool includeAuth = true}) async {
    try {
      return await _backend.delete(
        path,
        includeAuth: includeAuth,
        timeout: timeout,
        maxAttempts: 1,
      );
    } on BackendException catch (e) {
      _handleMaybeInvalidJwt(e);
      throw ApiException(statusCode: e.statusCode, code: e.code, message: e.message, details: e.details);
    }
  }

  void _handleMaybeInvalidJwt(BackendException e) {
    if (e.statusCode == 401) {
      // 先静默重签 JWT；失败才清 token。绝不清除 Google 身份。
      unawaited(TokenStorage.instance.recoverFromUnauthorized());
    }
  }
}

