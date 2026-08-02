import 'package:flutter/foundation.dart';
import 'package:google_sign_in/google_sign_in.dart';

import '../app_user_sync.dart';
import '../constants.dart';
import '../session/session_store.dart';
import '../storage_service.dart';
import '../../services/steam_backend_service.dart';

/// 登录会话编排：Google 身份与平台 JWT 分离；UI 通过 [addListener] 感知变化。
///
/// 恢复顺序：
/// 1. [restoreLocalSession] — 仅本地（prefs/Hive），无网络，启动关键路径必须完成
/// 2. [ensureBackendSession] — 有身份则补/刷新 JWT（可失败，不踢登录）
/// 3. [restoreSession] — 本地空时再尝试 Google 静默登录
class AuthService extends ChangeNotifier {
  static final AuthService _instance = AuthService._internal();
  factory AuthService() => _instance;
  AuthService._internal();

  final StorageService _storage = StorageService.instance;
  final SessionStore _session = SessionStore.instance;

  GoogleSignIn? _googleSignIn;
  Map<String, String>? _cachedUser;
  bool _refreshingJwt = false;

  GoogleSignIn get _google {
    _googleSignIn ??= () {
      final id = AppConstants.googleSignInClientId;
      if (kDebugMode) {
        debugPrint(
            'GoogleSignIn serverClientId(前30字符): ${id.length >= 30 ? id.substring(0, 30) : id}...');
      }
      return GoogleSignIn(
        serverClientId: id,
        scopes: ['email', 'profile'],
      );
    }();
    return _googleSignIn!;
  }

  /// 最近一次登录失败原因（供 UI 提示）
  static String? lastSignInError;

  Future<bool> isLoggedIn() async {
    if (_cachedUser != null && (_cachedUser!['userId'] ?? '').isNotEmpty) {
      return true;
    }
    return _session.hasIdentity();
  }

  /// 返回当前用户 { userId, email, photoUrl }，未登录返回 null
  Future<Map<String, String>?> getCurrentUser() async {
    if (_cachedUser != null && (_cachedUser!['userId'] ?? '').isNotEmpty) {
      return Map<String, String>.from(_cachedUser!);
    }
    final map = await _session.getIdentity();
    if (map.isEmpty) return null;
    _cachedUser = map;
    return Map<String, String>.from(map);
  }

  /// 仅本地恢复（无网络）。启动 splash 关键路径必须 await 完成。
  Future<void> restoreLocalSession() async {
    try {
      if (!_session.isInitialized) {
        await _session.init(
          prefs: _storage.isInitialized ? _storage.prefs : null,
        );
      }
      final id = await _session.getIdentity();
      if (id.isEmpty) {
        _cachedUser = null;
        return;
      }
      _cachedUser = id;
      notifyListeners();
    } catch (e) {
      if (kDebugMode) debugPrint('restoreLocalSession: $e');
    }
  }

  /// 有本地身份则确保平台 JWT 可用（网络）。失败不清除身份。
  Future<void> ensureBackendSession({bool forceRefresh = false}) async {
    try {
      final user = await getCurrentUser();
      if (user == null) return;
      final existing = await _session.getJwt();
      if (!forceRefresh && existing != null && existing.isNotEmpty) return;
      await _issueJwtForStoredUser(user);
    } catch (e) {
      if (kDebugMode) debugPrint('ensureBackendSession: $e');
    }
  }

  /// 冷启动完整恢复：本地 → JWT →（必要时）Google 静默。
  Future<void> restoreSession() async {
    try {
      await restoreLocalSession();
      if (await isLoggedIn()) {
        await ensureBackendSession();
        return;
      }
      GoogleSignInAccount? account;
      try {
        account = await _google.signInSilently();
      } catch (e) {
        if (kDebugMode) debugPrint('restoreSession signInSilently: $e');
        return;
      }
      if (account == null || account.id.isEmpty) return;
      await _persistAccount(account);
      await _createAppSessionForAccount(account);
      notifyListeners();
    } catch (e) {
      if (kDebugMode) debugPrint('restoreSession: $e');
    }
  }

  /// 401 时调用：用已存 Google 身份重签 JWT。成功返回 true。
  Future<bool> refreshJwtIfPossible() async {
    if (_refreshingJwt) return false;
    _refreshingJwt = true;
    try {
      final user = await getCurrentUser();
      if (user == null) return false;
      return await _issueJwtForStoredUser(user);
    } catch (e) {
      if (kDebugMode) debugPrint('refreshJwtIfPossible: $e');
      return false;
    } finally {
      _refreshingJwt = false;
    }
  }

  Future<Map<String, String>?> signInWithGoogle() async {
    lastSignInError = null;
    try {
      GoogleSignInAccount? account;
      try {
        account = await _google.signInSilently();
      } catch (_) {
        account = null;
      }
      account ??= await _google.signIn();
      if (account == null) return null;
      if (account.id.isEmpty) return null;
      await _persistAccount(account);
      await _createAppSessionForAccount(account);
      notifyListeners();
      return await getCurrentUser();
    } catch (e) {
      lastSignInError = _messageForSignInError(e);
      rethrow;
    }
  }

  Future<void> _persistAccount(GoogleSignInAccount account) async {
    await _session.saveIdentity(
      userId: account.id,
      email: account.email,
      photoUrl: account.photoUrl,
    );
    // 兼容旧调用方仍走 StorageService
    await _storage.setAuthUser(
      userId: account.id,
      email: account.email,
      photoUrl: account.photoUrl,
    );
    _cachedUser = {
      'userId': account.id,
      'email': account.email,
      'photoUrl': account.photoUrl ?? '',
    };
  }

  Future<bool> _issueJwtForStoredUser(Map<String, String> user) async {
    final userId = user['userId'] ?? '';
    if (userId.isEmpty) return false;
    try {
      final session = await SteamBackendService().createAppSession(
        googleUserId: userId,
        email: user['email'],
        photoUrl: user['photoUrl'],
      );
      final next = session['token']?.toString();
      if (next == null || next.isEmpty) return false;
      await _session.saveJwt(next);
      await _storage.setSteamBackendToken(next);
      await AppUserSync.afterAuthLogin();
      return true;
    } catch (e) {
      if (kDebugMode) debugPrint('issueJwt: $e');
      return false;
    }
  }

  Future<void> _createAppSessionForAccount(GoogleSignInAccount account) async {
    try {
      final session = await SteamBackendService().createAppSession(
        googleUserId: account.id,
        email: account.email,
        displayName: account.displayName,
        photoUrl: account.photoUrl,
      );
      final token = session['token']?.toString();
      if (token != null && token.isNotEmpty) {
        await _session.saveJwt(token);
        await _storage.setSteamBackendToken(token);
        await AppUserSync.afterAuthLogin();
      }
    } catch (e) {
      if (kDebugMode) debugPrint('App session bridge failed: $e');
    }
  }

  /// 登出：清除 Google 身份 + 平台 JWT（不误伤「仅清 JWT」路径）。
  Future<void> signOut() async {
    try {
      await _google.signOut();
    } catch (_) {}
    await _session.clearSession();
    await _storage.clearAuthUser();
    await _storage.clearPlatformJwt();
    _cachedUser = null;
    notifyListeners();
  }

  static String _messageForSignInError(dynamic e) {
    final s = e.toString();
    final lower = s.toLowerCase();
    final code10 = RegExp(r'ApiException:\s*10');
    final code7 = RegExp(r'ApiException:\s*7');
    final code8 = RegExp(r'ApiException:\s*8');
    if (code10.hasMatch(s) || (s.contains('sign_in_failed') && s.contains('10'))) {
      return '登录失败（错误码 10）：本机 SHA-1 与控制台不一致。请在项目运行 signingReport 核对，见 docs/GOOGLE_SIGNIN_SETUP.md';
    }
    if (code7.hasMatch(s)) {
      return '登录失败（错误码 7）：无法连接 Google 服务。请检查网络、更新 Google Play 服务，若在国内可尝试稳定代理后再试';
    }
    if (code8.hasMatch(s)) {
      return '登录失败（错误码 8）：Google Play 服务内部错误，请稍后重试或更新「Google Play 服务」';
    }
    if (s.contains('12501') || s.contains('canceled')) return '已取消登录';
    if (lower.contains('timeout') ||
        lower.contains('timed out') ||
        lower.contains('socketexception') ||
        lower.contains('failed host lookup') ||
        lower.contains('network is unreachable')) {
      return '连接 Google 超时或网络不可用。访问 Google 登录在国内往往较慢，请换网络或使用可靠代理后重试';
    }
    return s.length > 120 ? '${s.substring(0, 120)}…' : s;
  }
}
