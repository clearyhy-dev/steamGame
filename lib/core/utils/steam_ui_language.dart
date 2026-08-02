import 'dart:ui' as ui;

/// Steam `l=` parameter for store.steampowered.com API (full language tokens).
String steamAppDetailsLanguageParameter(String uiLanguageCode) {
  final x =
      uiLanguageCode.trim().toLowerCase().split('_').first.split('-').first;
  switch (x) {
    case 'zh':
      return 'schinese';
    case 'ja':
      return 'japanese';
    case 'ko':
      return 'koreana';
    case 'de':
      return 'german';
    case 'fr':
      return 'french';
    case 'es':
      return 'spanish';
    case 'pt':
      return 'portuguese';
    case 'ru':
      return 'russian';
    case 'pl':
      return 'polish';
    case 'it':
      return 'italian';
    case 'tr':
      return 'turkish';
    case 'th':
      return 'thai';
    case 'vi':
      return 'vietnamese';
    case 'ar':
      return 'arabic';
    case 'he':
      return 'hebrew';
    case 'el':
      return 'greek';
    case 'hi':
      return 'hindi';
    case 'id':
      return 'indonesian';
    case 'nl':
      return 'dutch';
    case 'sv':
      return 'swedish';
    case 'en':
    default:
      return 'english';
  }
}

/// Short ISO-style code (en, zh, ja) for backend `language=` query.
String normalizeUiLanguageCode(String? storedOrDevice) {
  final raw = (storedOrDevice ?? '').trim();
  String primary;
  if (raw.isEmpty) {
    final loc = ui.PlatformDispatcher.instance.locale;
    final c = loc.languageCode.trim().toLowerCase();
    primary = c.isEmpty ? 'en' : c.split('_').first.split('-').first;
  } else {
    primary = raw.toLowerCase().split('_').first.split('-').first;
  }
  switch (primary) {
    case 'japanese':
      return 'ja';
    case 'koreana':
      return 'ko';
    case 'schinese':
    case 'tchinese':
      return 'zh';
    case 'german':
      return 'de';
    case 'french':
      return 'fr';
    case 'spanish':
      return 'es';
    case 'portuguese':
      return 'pt';
    case 'russian':
      return 'ru';
    case 'polish':
      return 'pl';
    case 'italian':
      return 'it';
    case 'turkish':
      return 'tr';
    case 'thai':
      return 'th';
    case 'vietnamese':
      return 'vi';
    case 'arabic':
      return 'ar';
    case 'hebrew':
      return 'he';
    case 'greek':
      return 'el';
    case 'hindi':
      return 'hi';
    case 'indonesian':
      return 'id';
    case 'dutch':
      return 'nl';
    case 'swedish':
      return 'sv';
    default:
      return primary;
  }
}

/// App `supportedLocales` — uiLanguage 只能落在这些码上。
const kAppSupportedUiLanguages = <String>{
  'en', 'zh', 'ja', 'ko', 'fr', 'ru', 'de', 'es',
  'ur', 'id', 'tr', 'vi', 'th', 'hi', 'pt', 'ar',
  'pl', 'it', 'nl', 'sv', 'he', 'el',
};

/// 空值时的建议默认（不会覆盖 Admin 已存的合法 App 语言，含 en）。
const Map<String, String> kPreferredUiLanguageByCountry = {
  'US': 'en',
  'GB': 'en',
  'AU': 'en',
  'NZ': 'en',
  'IE': 'en',
  'CA': 'en',
  'CN': 'zh',
  'TW': 'zh',
  'HK': 'zh',
  'SG': 'zh',
  'JP': 'ja',
  'KR': 'ko',
  'FR': 'fr',
  'BE': 'fr',
  'DE': 'de',
  'AT': 'de',
  'CH': 'de',
  'BR': 'pt',
  'PT': 'pt',
  'PL': 'pl',
  'ES': 'es',
  'MX': 'es',
  'AR': 'es',
  'CL': 'es',
  'CO': 'es',
  'PE': 'es',
  'IT': 'it',
  'RU': 'ru',
  'UA': 'ru',
  'TR': 'tr',
  'VN': 'vi',
  'TH': 'th',
  'ID': 'id',
  'IN': 'hi',
  'PK': 'ur',
  'SA': 'ar',
  'AE': 'ar',
  'EG': 'ar',
  'IL': 'he',
  'GR': 'el',
  'NL': 'nl',
  'SE': 'sv',
};

/// 只匹配 App 已有多语言。
/// FR/JP 等有专属语言：空或历史 en → 专属语言；显式其它 App 语言保留。
/// US 等英文区 / 无映射：保留合法值，否则 en。
String resolveCatalogUiLanguage({
  required String countryCode,
  required String apiUiLanguage,
  String? steamLanguage,
}) {
  final cc = countryCode.trim().toUpperCase();
  final mapped = kPreferredUiLanguageByCountry[cc];
  final mappedOk =
      (mapped != null && kAppSupportedUiLanguages.contains(mapped)) ? mapped : '';
  final apiRaw = apiUiLanguage.trim();
  final api = apiRaw.isEmpty ? '' : normalizeUiLanguageCode(apiRaw);
  final apiOk =
      (api.isNotEmpty && kAppSupportedUiLanguages.contains(api)) ? api : '';

  if (mappedOk.isNotEmpty && mappedOk != 'en') {
    if (apiOk.isEmpty || apiOk == 'en') return mappedOk;
    return apiOk;
  }
  if (apiOk.isNotEmpty) return apiOk;
  if (mappedOk.isNotEmpty) return mappedOk;

  final steam = normalizeUiLanguageCode(steamLanguage ?? '');
  if (steam.isNotEmpty && kAppSupportedUiLanguages.contains(steam)) {
    return steam;
  }
  return 'en';
}
