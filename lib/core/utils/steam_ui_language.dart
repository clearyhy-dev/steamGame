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
