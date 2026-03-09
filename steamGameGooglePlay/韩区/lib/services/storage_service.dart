import 'dart:convert';

import 'package:hive_flutter/hive_flutter.dart';

class StorageService {
  static const String _boxName = 'matchmuse';
  static const String _keyPurchased = 'purchased';
  static const String _keyUid = 'uid';
  static const String _keyHistory = 'history';
  static const String _keyAnalysisHistoryByUid = 'analysis_history_by_uid';
  static const String _keyLanguage = 'language';
  static const int _maxHistory = 20;
  static const int _maxAnalysisHistoryPerUser = 200;

  static Box<dynamic>? _box;

  static Future<void> init() async {
    await Hive.initFlutter();
    _box = await Hive.openBox<dynamic>(_boxName);
  }

  static bool get hasUnlockedFullReport =>
      _box?.get(_keyPurchased, defaultValue: false) as bool;

  static Future<void> setFullReportUnlocked(bool value) async {
    await _box?.put(_keyPurchased, value);
  }

  static String? get uid => _box?.get(_keyUid) as String?;

  static Future<void> setUid(String value) async {
    await _box?.put(_keyUid, value);
  }

  static List<Map<String, dynamic>> get history {
    final raw = _box?.get(_keyHistory);
    if (raw == null) return [];
    try {
      final list = jsonDecode(raw as String) as List<dynamic>;
      return list.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  /// 用户选择的语言：en / ja / ko / zh，null 表示跟随系统
  static String? get languageOverride => _box?.get(_keyLanguage) as String?;

  static Future<void> setLanguageOverride(String? lang) async {
    if (lang == null) {
      await _box?.delete(_keyLanguage);
    } else {
      await _box?.put(_keyLanguage, lang);
    }
  }

  static Future<void> addHistory({
    required String enhancedUrl,
    required int score,
    String? thumbnailPath,
  }) async {
    final list = history;
    list.insert(0, {
      'url': enhancedUrl,
      'score': score,
      'ts': DateTime.now().toIso8601String(),
      'thumb': thumbnailPath,
    });
    while (list.length > _maxHistory) list.removeLast();
    await _box?.put(_keyHistory, jsonEncode(list));
  }

  /// 按用户维度保存「上传图片的分析结果」历史：每张图一条记录（含评分、建议、可选美化结果）。
  static List<Map<String, dynamic>> getAnalysisHistory(String uid) {
    final raw = _box?.get(_keyAnalysisHistoryByUid);
    if (raw == null) return [];
    try {
      final map = jsonDecode(raw as String) as Map<String, dynamic>;
      final list = map[uid];
      if (list is! List) return [];
      return list
          .map((e) => Map<String, dynamic>.from(e as Map))
          .toList()
          .cast<Map<String, dynamic>>();
    } catch (_) {
      return [];
    }
  }

  static Future<void> addAnalysisHistoryEntry({
    required String uid,
    required Map<String, dynamic> entry,
  }) async {
    Map<String, dynamic> map = {};
    final raw = _box?.get(_keyAnalysisHistoryByUid);
    if (raw != null) {
      try {
        map = jsonDecode(raw as String) as Map<String, dynamic>;
      } catch (_) {
        map = {};
      }
    }
    final listRaw = map[uid];
    final list = (listRaw is List)
        ? listRaw.map((e) => Map<String, dynamic>.from(e as Map)).toList()
        : <Map<String, dynamic>>[];
    list.insert(0, entry);
    while (list.length > _maxAnalysisHistoryPerUser) {
      list.removeLast();
    }
    map[uid] = list;
    await _box?.put(_keyAnalysisHistoryByUid, jsonEncode(map));
  }

  /// 更新某条分析历史的美化结果（按 entryId 定位）
  static Future<void> setAnalysisHistoryEnhanceResult({
    required String uid,
    required String entryId,
    required String enhancedUrl,
    required String style,
  }) async {
    Map<String, dynamic> map = {};
    final raw = _box?.get(_keyAnalysisHistoryByUid);
    if (raw == null) return;
    try {
      map = jsonDecode(raw as String) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    final listRaw = map[uid];
    if (listRaw is! List) return;
    final list =
        listRaw.map((e) => Map<String, dynamic>.from(e as Map)).toList();
    final idx = list.indexWhere((e) => e['id'] == entryId);
    if (idx < 0) return;
    list[idx] = {
      ...list[idx],
      'enhancedUrl': enhancedUrl,
      'enhanceStyle': style,
      'enhancedTs': DateTime.now().toIso8601String(),
    };
    map[uid] = list;
    await _box?.put(_keyAnalysisHistoryByUid, jsonEncode(map));
  }
}
