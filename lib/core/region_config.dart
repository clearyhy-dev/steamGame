/// 按国家/地区选择：选择国家后使用该国家的语言 + 时区（与 Google Play 常用地区一致）
/// 英语国家 30 个（15 原有 + 15 新增 Google Play 常用）；其余国家/地区各对应一种语言 + 时区
class RegionConfig {
  RegionConfig._();

  /// 地区项：id 存 Storage，displayName 用于选择列表，localeCode 用于 App 语言，timezoneId 用于每日 17:00 等
  static const List<RegionEntry> allRegions = [
    // ---------- 30 个使用英语且 Google Play 常用国家 ----------
    RegionEntry(id: 'US', displayName: 'United States', localeCode: 'en', timezoneId: 'America/New_York'),
    RegionEntry(id: 'GB', displayName: 'United Kingdom', localeCode: 'en', timezoneId: 'Europe/London'),
    RegionEntry(id: 'CA', displayName: 'Canada', localeCode: 'en', timezoneId: 'America/Toronto'),
    RegionEntry(id: 'AU', displayName: 'Australia', localeCode: 'en', timezoneId: 'Australia/Sydney'),
    RegionEntry(id: 'IN', displayName: 'India', localeCode: 'en', timezoneId: 'Asia/Kolkata'),
    RegionEntry(id: 'IE', displayName: 'Ireland', localeCode: 'en', timezoneId: 'Europe/Dublin'),
    RegionEntry(id: 'ZA', displayName: 'South Africa', localeCode: 'en', timezoneId: 'Africa/Johannesburg'),
    RegionEntry(id: 'NZ', displayName: 'New Zealand', localeCode: 'en', timezoneId: 'Pacific/Auckland'),
    RegionEntry(id: 'PH', displayName: 'Philippines', localeCode: 'en', timezoneId: 'Asia/Manila'),
    RegionEntry(id: 'SG', displayName: 'Singapore', localeCode: 'en', timezoneId: 'Asia/Singapore'),
    RegionEntry(id: 'MY', displayName: 'Malaysia', localeCode: 'en', timezoneId: 'Asia/Kuala_Lumpur'),
    RegionEntry(id: 'NG', displayName: 'Nigeria', localeCode: 'en', timezoneId: 'Africa/Lagos'),
    RegionEntry(id: 'PK', displayName: 'Pakistan', localeCode: 'en', timezoneId: 'Asia/Karachi'),
    RegionEntry(id: 'BD', displayName: 'Bangladesh', localeCode: 'en', timezoneId: 'Asia/Dhaka'),
    RegionEntry(id: 'KE', displayName: 'Kenya', localeCode: 'en', timezoneId: 'Africa/Nairobi'),
    RegionEntry(id: 'HK', displayName: 'Hong Kong', localeCode: 'en', timezoneId: 'Asia/Hong_Kong'),
    RegionEntry(id: 'LK', displayName: 'Sri Lanka', localeCode: 'en', timezoneId: 'Asia/Colombo'),
    RegionEntry(id: 'NP', displayName: 'Nepal', localeCode: 'en', timezoneId: 'Asia/Kathmandu'),
    RegionEntry(id: 'GH', displayName: 'Ghana', localeCode: 'en', timezoneId: 'Africa/Accra'),
    RegionEntry(id: 'TZ', displayName: 'Tanzania', localeCode: 'en', timezoneId: 'Africa/Dar_es_Salaam'),
    RegionEntry(id: 'UG', displayName: 'Uganda', localeCode: 'en', timezoneId: 'Africa/Kampala'),
    RegionEntry(id: 'JM', displayName: 'Jamaica', localeCode: 'en', timezoneId: 'America/Jamaica'),
    RegionEntry(id: 'TT', displayName: 'Trinidad and Tobago', localeCode: 'en', timezoneId: 'America/Port_of_Spain'),
    RegionEntry(id: 'MT', displayName: 'Malta', localeCode: 'en', timezoneId: 'Europe/Malta'),
    RegionEntry(id: 'CY', displayName: 'Cyprus', localeCode: 'en', timezoneId: 'Asia/Nicosia'),
    RegionEntry(id: 'ZW', displayName: 'Zimbabwe', localeCode: 'en', timezoneId: 'Africa/Harare'),
    RegionEntry(id: 'MU', displayName: 'Mauritius', localeCode: 'en', timezoneId: 'Indian/Mauritius'),
    RegionEntry(id: 'BZ', displayName: 'Belize', localeCode: 'en', timezoneId: 'America/Belize'),
    RegionEntry(id: 'GY', displayName: 'Guyana', localeCode: 'en', timezoneId: 'America/Guyana'),
    RegionEntry(id: 'ET', displayName: 'Ethiopia', localeCode: 'en', timezoneId: 'Africa/Addis_Ababa'),
    RegionEntry(id: 'BW', displayName: 'Botswana', localeCode: 'en', timezoneId: 'Africa/Gaborone'),
    // ---------- 其他语言国家/地区（一国一语 + 对应时区） ----------
    RegionEntry(id: 'CN', displayName: '中国', localeCode: 'zh', timezoneId: 'Asia/Shanghai'),
    RegionEntry(id: 'JP', displayName: '日本', localeCode: 'ja', timezoneId: 'Asia/Tokyo'),
    RegionEntry(id: 'KR', displayName: '한국', localeCode: 'ko', timezoneId: 'Asia/Seoul'),
    RegionEntry(id: 'DE', displayName: 'Deutschland', localeCode: 'de', timezoneId: 'Europe/Berlin'),
    RegionEntry(id: 'FR', displayName: 'France', localeCode: 'fr', timezoneId: 'Europe/Paris'),
    RegionEntry(id: 'RU', displayName: 'Россия', localeCode: 'ru', timezoneId: 'Europe/Moscow'),
    RegionEntry(id: 'ES', displayName: 'España', localeCode: 'es', timezoneId: 'Europe/Madrid'),
    RegionEntry(id: 'BR', displayName: 'Brasil', localeCode: 'pt', timezoneId: 'America/Sao_Paulo'),
    RegionEntry(id: 'IT', displayName: 'Italia', localeCode: 'it', timezoneId: 'Europe/Rome'),
    RegionEntry(id: 'NL', displayName: 'Nederland', localeCode: 'nl', timezoneId: 'Europe/Amsterdam'),
    RegionEntry(id: 'PL', displayName: 'Polska', localeCode: 'pl', timezoneId: 'Europe/Warsaw'),
    RegionEntry(id: 'SA', displayName: 'السعودية', localeCode: 'ar', timezoneId: 'Asia/Riyadh'),
    RegionEntry(id: 'TR', displayName: 'Türkiye', localeCode: 'tr', timezoneId: 'Europe/Istanbul'),
    RegionEntry(id: 'ID', displayName: 'Indonesia', localeCode: 'id', timezoneId: 'Asia/Jakarta'),
    RegionEntry(id: 'VN', displayName: 'Việt Nam', localeCode: 'vi', timezoneId: 'Asia/Ho_Chi_Minh'),
    RegionEntry(id: 'TH', displayName: 'ไทย', localeCode: 'th', timezoneId: 'Asia/Bangkok'),
  ];

  static const Set<String> _legacyLocaleCodes = {
    'en', 'zh', 'ja', 'ko', 'fr', 'ru', 'de', 'es', 'ur', 'id', 'tr', 'vi', 'th', 'hi', 'pt', 'ar', 'pl', 'it', 'nl', 'sv', 'he', 'el',
  };

  /// 旧版「语言代码」-> 默认时区（兼容未迁移用户）
  static const Map<String, String> _legacyLocaleToTimeZone = {
    'zh': 'Asia/Shanghai',
    'ja': 'Asia/Tokyo',
    'ko': 'Asia/Seoul',
    'en': 'America/New_York',
    'de': 'Europe/Berlin',
    'fr': 'Europe/Paris',
    'ru': 'Europe/Moscow',
    'es': 'Europe/Madrid',
    'pt': 'America/Sao_Paulo',
    'it': 'Europe/Rome',
    'nl': 'Europe/Amsterdam',
    'pl': 'Europe/Warsaw',
    'ar': 'Asia/Riyadh',
    'tr': 'Europe/Istanbul',
    'id': 'Asia/Jakarta',
    'vi': 'Asia/Ho_Chi_Minh',
    'th': 'Asia/Bangkok',
    'hi': 'Asia/Kolkata',
    'ur': 'Asia/Karachi',
    'sv': 'Europe/Stockholm',
    'he': 'Asia/Jerusalem',
    'el': 'Europe/Athens',
  };

  /// 存储值为 regionId（如 US、CN）或旧版 languageCode（如 en、zh）。返回用于 App UI 的 localeCode。
  static String? getLocaleCodeForApp(String? stored) {
    if (stored == null || stored.isEmpty) return null;
    final s = stored.trim();
    if (_legacyLocaleCodes.contains(s)) return s;
    for (final r in allRegions) if (r.id == s) return r.localeCode;
    return null;
  }

  /// 存储值为 regionId 或旧版 languageCode。返回 IANA 时区 id，用于每日 17:00 等。
  static String getTimezoneId(String? stored) {
    if (stored == null || stored.isEmpty) return 'Asia/Shanghai';
    final s = stored.trim();
    for (final r in allRegions) if (r.id == s) return r.timezoneId;
    if (_legacyLocaleToTimeZone.containsKey(s)) return _legacyLocaleToTimeZone[s]!;
    return 'Asia/Shanghai';
  }

  /// 是否为已支持的 region id（用于判断当前存的是新区还是旧语言码）
  static bool isRegionId(String? value) {
    if (value == null || value.isEmpty) return false;
    return allRegions.any((e) => e.id == value.trim());
  }

  /// 获取存储值对应的显示名称（用于选择器当前项展示）。legacy 语言码会映射到第一个对应国家。
  static String getDisplayNameForStored(String? stored, String systemDefaultLabel) {
    if (stored == null || stored.isEmpty) return systemDefaultLabel;
    final s = stored.trim();
    for (final r in allRegions) if (r.id == s) return r.displayName;
    for (final r in allRegions) if (r.localeCode == s) return r.displayName;
    return s;
  }
}

class RegionEntry {
  final String id;
  final String displayName;
  final String localeCode;
  final String timezoneId;

  const RegionEntry({
    required this.id,
    required this.displayName,
    required this.localeCode,
    required this.timezoneId,
  });
}
