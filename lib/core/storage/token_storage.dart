import '../storage_service.dart';

class TokenStorage {
  TokenStorage._();
  static final TokenStorage instance = TokenStorage._();

  Future<void> saveJwt(String token) async {
    await StorageService.instance.setSteamBackendToken(token);
  }

  Future<String?> getJwt() async {
    return StorageService.instance.getSteamBackendToken();
  }

  Future<void> clearJwt() async {
    await StorageService.instance.clearSteamBackendToken();
  }

  Future<bool> hasJwt() async {
    final t = await getJwt();
    return t != null && t.isNotEmpty;
  }
}

