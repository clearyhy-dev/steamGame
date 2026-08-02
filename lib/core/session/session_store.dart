import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../constants.dart';

/// 登录身份 + 平台 JWT 的持久化层。
///
/// - SharedPreferences：主存储（现有键）
/// - Hive `auth_session_v1`：备份，防止 prefs 异步落盘失败 / 进程被杀导致丢登录
///
/// 约定：JWT 失效 **不得** 清除 Google 身份；Steam 资料与平台 JWT 分离清理。
class SessionStore {
  SessionStore._();
  static final SessionStore instance = SessionStore._();

  static const String _hiveBox = 'auth_session_v1';
  static const String _hkUserId = 'user_id';
  static const String _hkEmail = 'email';
  static const String _hkPhoto = 'photo_url';
  static const String _hkJwt = 'platform_jwt';

  SharedPreferences? _prefs;
  Box? _box;
  bool _inited = false;

  bool get isInitialized => _inited;

  Future<void> init({SharedPreferences? prefs}) async {
    if (_inited) return;
    _prefs = prefs ?? await SharedPreferences.getInstance();
    try {
      await Hive.initFlutter();
      _box = Hive.isBoxOpen(_hiveBox)
          ? Hive.box(_hiveBox)
          : await Hive.openBox(_hiveBox);
    } catch (e) {
      if (kDebugMode) debugPrint('SessionStore Hive open: $e');
      _box = null;
    }
    await _healPrefsFromBackup();
    _inited = true;
  }

  SharedPreferences get _p {
    final p = _prefs;
    if (p == null) {
      throw StateError('SessionStore.init() must be called first');
    }
    return p;
  }

  /// prefs 空但 Hive 有备份时回填 prefs（冷启动首要步骤，无网络）。
  Future<void> _healPrefsFromBackup() async {
    final box = _box;
    if (box == null) return;
    final prefs = _p;

    final prefsId = prefs.getString(AppConstants.keyAuthUserId);
    final hiveId = (box.get(_hkUserId) as String?)?.trim() ?? '';
    if ((prefsId == null || prefsId.isEmpty) && hiveId.isNotEmpty) {
      await prefs.setString(AppConstants.keyAuthUserId, hiveId);
      await prefs.setString(
          AppConstants.keyAuthEmail, (box.get(_hkEmail) as String?) ?? '');
      await prefs.setString(
          AppConstants.keyAuthPhotoUrl, (box.get(_hkPhoto) as String?) ?? '');
      if (kDebugMode) {
        debugPrint('SessionStore: healed Google identity from Hive backup');
      }
    }

    final prefsJwt = prefs.getString(AppConstants.keySteamBackendToken);
    final hiveJwt = (box.get(_hkJwt) as String?)?.trim() ?? '';
    if ((prefsJwt == null || prefsJwt.isEmpty) && hiveJwt.isNotEmpty) {
      await prefs.setString(AppConstants.keySteamBackendToken, hiveJwt);
      if (kDebugMode) {
        debugPrint('SessionStore: healed platform JWT from Hive backup');
      }
    }

    // 反向：prefs 有、Hive 空 → 补备份
    final id = prefs.getString(AppConstants.keyAuthUserId);
    if (id != null && id.isNotEmpty && hiveId.isEmpty) {
      await box.put(_hkUserId, id);
      await box.put(
          _hkEmail, prefs.getString(AppConstants.keyAuthEmail) ?? '');
      await box.put(
          _hkPhoto, prefs.getString(AppConstants.keyAuthPhotoUrl) ?? '');
    }
    final jwt = prefs.getString(AppConstants.keySteamBackendToken);
    if (jwt != null && jwt.isNotEmpty && hiveJwt.isEmpty) {
      await box.put(_hkJwt, jwt);
    }
  }

  Future<bool> hasIdentity() async {
    final id = await getUserId();
    return id != null && id.isNotEmpty;
  }

  Future<String?> getUserId() async {
    if (!_inited) return null;
    final fromPrefs = _p.getString(AppConstants.keyAuthUserId)?.trim();
    if (fromPrefs != null && fromPrefs.isNotEmpty) return fromPrefs;
    final fromHive = (_box?.get(_hkUserId) as String?)?.trim();
    if (fromHive != null && fromHive.isNotEmpty) return fromHive;
    return null;
  }

  Future<Map<String, String>> getIdentity() async {
    if (!_inited) return {};
    final id = await getUserId();
    if (id == null || id.isEmpty) return {};
    final email = _p.getString(AppConstants.keyAuthEmail) ??
        (_box?.get(_hkEmail) as String?) ??
        '';
    final photo = _p.getString(AppConstants.keyAuthPhotoUrl) ??
        (_box?.get(_hkPhoto) as String?) ??
        '';
    return {'userId': id, 'email': email, 'photoUrl': photo};
  }

  Future<void> saveIdentity({
    required String userId,
    String? email,
    String? photoUrl,
  }) async {
    if (!_inited) await init();
    final id = userId.trim();
    if (id.isEmpty) return;
    final em = email ?? '';
    final ph = photoUrl ?? '';

    await _p.setString(AppConstants.keyAuthUserId, id);
    await _p.setString(AppConstants.keyAuthEmail, em);
    await _p.setString(AppConstants.keyAuthPhotoUrl, ph);

    try {
      await _box?.put(_hkUserId, id);
      await _box?.put(_hkEmail, em);
      await _box?.put(_hkPhoto, ph);
      await _box?.flush();
    } catch (e) {
      if (kDebugMode) debugPrint('SessionStore.saveIdentity hive: $e');
    }

    // 读回校验；失败则再写一次
    final verify = _p.getString(AppConstants.keyAuthUserId);
    if (verify != id) {
      await _p.setString(AppConstants.keyAuthUserId, id);
      await _p.setString(AppConstants.keyAuthEmail, em);
      await _p.setString(AppConstants.keyAuthPhotoUrl, ph);
    }
  }

  Future<void> clearIdentity() async {
    if (!_inited) return;
    await _p.remove(AppConstants.keyAuthUserId);
    await _p.remove(AppConstants.keyAuthEmail);
    await _p.remove(AppConstants.keyAuthPhotoUrl);
    try {
      await _box?.delete(_hkUserId);
      await _box?.delete(_hkEmail);
      await _box?.delete(_hkPhoto);
      await _box?.flush();
    } catch (_) {}
  }

  Future<String?> getJwt() async {
    if (!_inited) return null;
    final fromPrefs = _p.getString(AppConstants.keySteamBackendToken)?.trim();
    if (fromPrefs != null && fromPrefs.isNotEmpty) return fromPrefs;
    final fromHive = (_box?.get(_hkJwt) as String?)?.trim();
    if (fromHive != null && fromHive.isNotEmpty) {
      await _p.setString(AppConstants.keySteamBackendToken, fromHive);
      return fromHive;
    }
    return null;
  }

  Future<void> saveJwt(String token) async {
    if (!_inited) await init();
    final t = token.trim();
    if (t.isEmpty) return;
    await _p.setString(AppConstants.keySteamBackendToken, t);
    try {
      await _box?.put(_hkJwt, t);
      await _box?.flush();
    } catch (e) {
      if (kDebugMode) debugPrint('SessionStore.saveJwt hive: $e');
    }
  }

  /// 仅清平台 JWT，保留 Google 身份与 Steam 资料缓存。
  Future<void> clearJwtOnly() async {
    if (!_inited) return;
    await _p.remove(AppConstants.keySteamBackendToken);
    try {
      await _box?.delete(_hkJwt);
      await _box?.flush();
    } catch (_) {}
  }

  /// 主动登出：身份 + JWT。
  Future<void> clearSession() async {
    await clearIdentity();
    await clearJwtOnly();
    await _p.remove(AppConstants.keyBackendTrialUntil);
  }
}
