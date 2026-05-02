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
  if (raw.isEmpty) {
    final loc = ui.PlatformDispatcher.instance.locale;
    final c = loc.languageCode.trim().toLowerCase();
    return c.isEmpty ? 'en' : c.split('_').first.split('-').first;
  }
  return raw.toLowerCase().split('_').first.split('-').first;
}
