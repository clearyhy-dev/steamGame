import '../services/auth_service.dart';
import '../session/session_store.dart';
import '../storage_service.dart';

class TokenStorage {
  TokenStorage._();
  static final TokenStorage instance = TokenStorage._();

  Future<void> saveJwt(String token) async {
    await SessionStore.instance.saveJwt(token);
    await StorageService.instance.setSteamBackendToken(token);
  }

  Future<String?> getJwt() async {
    final fromSession = await SessionStore.instance.getJwt();
    if (fromSession != null && fromSession.isNotEmpty) return fromSession;
    return StorageService.instance.getSteamBackendToken();
  }

  /// 仅清 JWT。不得清除 Google 身份 / Steam 资料。
  Future<void> clearJwt() async {
    await SessionStore.instance.clearJwtOnly();
    await StorageService.instance.clearPlatformJwt();
  }

  Future<bool> hasJwt() async {
    final t = await getJwt();
    return t != null && t.isNotEmpty;
  }

  /// 401 时：先尝试用本地 Google 身份重签，失败才清 JWT。
  Future<bool> recoverFromUnauthorized() async {
    final ok = await AuthService().refreshJwtIfPossible();
    if (ok) return true;
    await clearJwt();
    return false;
  }
}
