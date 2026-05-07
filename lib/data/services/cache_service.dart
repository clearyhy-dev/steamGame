import 'dart:convert';
import 'package:hive_flutter/hive_flutter.dart';
import '../../models/game_model.dart';
/// 数据层：Hive 本地缓存，启动秒开
/// Hive 分区键与 [StorageService] 中 `_hiveBoxName` 一致（皆为 `deal_cache`），清空逻辑需在两侧保持同步。
class CacheService {
  static const String _boxName = 'deal_cache';
  static const String _keyDeals = 'deals';
  static String _dealsKey(String? countryCode) {
    final cc = (countryCode ?? '').trim().toUpperCase();
    return cc.isEmpty ? _keyDeals : '${_keyDeals}_$cc';
  }
  static String _lastCheckKey(String? countryCode) {
    final cc = (countryCode ?? '').trim().toUpperCase();
    return cc.isEmpty ? 'last_check_time' : 'last_check_time_$cc';
  }

  static bool _inited = false;
  static bool get isInitialized => _inited;

  static Future<void> init() async {
    if (_inited) return;
    try {
      await Hive.initFlutter();
      await Hive.openBox(_boxName);
      _inited = true;
    } catch (_) {}
  }

  static Future<List<GameModel>> loadGames({String? countryCode}) async {
    try {
      final box = Hive.box(_boxName);
      final jsonStr = box.get(_dealsKey(countryCode)) as String?;
      if (jsonStr == null || jsonStr.isEmpty) return [];
      final list = jsonDecode(jsonStr) as List<dynamic>;
      return list
          .map((e) => GameModel.fromJson(Map<String, dynamic>.from(e as Map)))
          .toList();
    } catch (_) {
      return [];
    }
  }

  static Future<void> saveGames(List<GameModel> games, {String? countryCode}) async {
    try {
      final list = games.map((g) => g.toJson()).toList();
      final box = Hive.box(_boxName);
      await box.put(_dealsKey(countryCode), jsonEncode(list));
      await box.put(_lastCheckKey(countryCode), DateTime.now().toIso8601String());
    } catch (_) {}
  }

  static Future<String?> getLastCheckTime({String? countryCode}) async {
    try {
      return Hive.box(_boxName).get(_lastCheckKey(countryCode)) as String?;
    } catch (_) {
      return null;
    }
  }

  static Future<void> setLastCheckTime(String iso, {String? countryCode}) async {
    try {
      await Hive.box(_boxName).put(_lastCheckKey(countryCode), iso);
    } catch (_) {}
  }

  /// 清空上次刷新时间（地区切换后，下次进入发现页会重新拉取）
  static Future<void> clearLastCheckTime() async {
    try {
      final box = Hive.box(_boxName);
      final keys = box.keys.map((e) => e.toString()).toList();
      for (final key in keys) {
        if (key == 'last_check_time' || key.startsWith('last_check_time_')) {
          await box.delete(key);
        }
      }
    } catch (_) {}
  }
}
