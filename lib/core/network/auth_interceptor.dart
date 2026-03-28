import '../storage/token_storage.dart';

class AuthInterceptor {
  Future<Map<String, String>> buildHeaders({
    bool includeAuth = true,
    Map<String, String>? extra,
  }) async {
    final headers = <String, String>{
      'Content-Type': 'application/json',
      ...?extra,
    };
    if (!includeAuth) return headers;
    final token = await TokenStorage.instance.getJwt();
    if (token != null && token.isNotEmpty) {
      headers['Authorization'] = 'Bearer $token';
    }
    return headers;
  }
}

