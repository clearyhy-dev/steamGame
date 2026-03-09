import 'package:timezone/timezone.dart' as tz;
import 'package:timezone/data/latest_all.dart' as tz_data;
import 'region_config.dart';

/// 每日通知：11:00 / 17:00 / 20:00（按所选地区语言时区）
class ScheduleConfig {
  ScheduleConfig._();

  /// 每日通知时刻：上午 11 点、下午 5 点、晚上 8 点（分钟均为 0）
  static const List<int> notificationHours = [11, 17, 20];
  static const int dailyMinute = 0;

  /// 今日折扣推送：沿用 17:00 用于兼容旧逻辑（实际用 delayUntilNextSlot）
  static const int dailyHour = 17;

  /// Pro 愿望单推送：同三时段
  static const int wishlistHour = 17;
  static const int wishlistMinute = 0;

  static bool _tzInitialized = false;
  static void _ensureTz() {
    if (!_tzInitialized) {
      tz_data.initializeTimeZones();
      _tzInitialized = true;
    }
  }

  /// 根据存储值（regionId 或 legacy 语言码）获取时区 Location。null/空时使用设备本地时区
  static tz.Location getLocationForLocale(String? stored) {
    _ensureTz();
    if (stored == null || stored.trim().isEmpty) {
      try {
        return tz.local;
      } catch (_) {}
    }
    final tzId = RegionConfig.getTimezoneId(stored);
    try {
      return tz.getLocation(tzId);
    } catch (_) {}
    try {
      return tz.getLocation('Asia/Shanghai');
    } catch (_) {
      return tz.UTC;
    }
  }

  /// 计算「距离下一个 11:00 / 17:00 / 20:00」的延迟（按所选国家时区）
  static Duration delayUntilNextSlot(String? localeCode) {
    _ensureTz();
    final location = getLocationForLocale(localeCode);
    final now = tz.TZDateTime.now(location);
    tz.TZDateTime? next;
    for (final h in notificationHours) {
      var t = tz.TZDateTime(location, now.year, now.month, now.day, h, dailyMinute);
      if (!t.isAfter(now)) t = t.add(const Duration(days: 1));
      if (next == null || t.isBefore(next)) next = t;
    }
    return next!.toUtc().difference(DateTime.now().toUtc());
  }

  /// 兼容旧名：等同于 delayUntilNextSlot
  static Duration delayUntilNext8AM(String? localeCode) => delayUntilNextSlot(localeCode);

  /// 每日任务再次调度：下次 17:00（同上时区）
  static Duration delayUntilNext8AMFromNow(String? localeCode) {
    return delayUntilNext8AM(localeCode);
  }

  /// 距离下一推送时刻（11/17/20）的延迟，用于 Pro 愿望单
  static Duration delayUntilNext5PM(String? localeCode) => delayUntilNextSlot(localeCode);

  /// 兼容旧逻辑：每日任务再次调度间隔（任务执行后约 24 小时再跑）— 已改为按 17 点
  static const Duration dailyInterval = Duration(hours: 24);

  /// 按语言时区判断：上次缓存时间是否已不是「今天」（即已是新的一天，应强制拉新数据）
  /// [lastCheckTimeIso] 为上次刷新时间的 ISO8601 字符串（如 from getLastCheckTime）
  /// [localeCode] 为应用语言代码（如 from StorageService.getPreferredLocale）
  /// 返回 true 表示已是新的一天，应强制刷新今日折扣
  static bool isNewDayInLocale(String? lastCheckTimeIso, String? localeCode) {
    if (lastCheckTimeIso == null || lastCheckTimeIso.isEmpty) return true;
    try {
      final cacheUtc = DateTime.parse(lastCheckTimeIso).toUtc();
      _ensureTz();
      final location = getLocationForLocale(localeCode);
      final cacheLocal = tz.TZDateTime.from(cacheUtc, location);
      final nowLocal = tz.TZDateTime.now(location);
      final cacheDate = DateTime(cacheLocal.year, cacheLocal.month, cacheLocal.day);
      final today = DateTime(nowLocal.year, nowLocal.month, nowLocal.day);
      return cacheDate.isBefore(today);
    } catch (_) {
      return true;
    }
  }
}
