import 'dart:ui' show PlatformDispatcher;

import 'constants/api_constants.dart';
import 'country_catalog_service.dart';
import 'services/client_region_client.dart';
import 'storage_service.dart';
import 'utils/steam_ui_language.dart';
class AppCountryContext {
  const AppCountryContext({
    required this.countryCode,
    required this.countryName,
    required this.steamCc,
    required this.steamLanguage,
    required this.currency,
    required this.currencySymbol,
    required this.uiLanguageCode,
    required this.source,
  });

  final String countryCode;
  final String countryName;
  final String steamCc;
  final String steamLanguage;
  final String currency;
  final String currencySymbol;
  final String uiLanguageCode;
  final String source; // manual / device_country / default / fallback / sync
}

class AppCountryResolver {
  AppCountryResolver._();

  static AppCountryContext _fromEntry({
    required CountryCatalogEntry entry,
    required String source,
  }) {
    return AppCountryContext(
      countryCode: entry.countryCode,
      countryName: entry.countryName,
      steamCc: entry.steamCc,
      steamLanguage: entry.steamLanguage,
      currency: entry.defaultCurrency,
      currencySymbol: entry.currencySymbol,
      uiLanguageCode: normalizeUiLanguageCode(entry.uiLanguage),
      source: source,
    );
  }

  static AppCountryContext _fallback({
    required String uiLanguageCode,
    required String source,
  }) {
    return AppCountryContext(
      countryCode: 'US',
      countryName: 'United States',
      steamCc: 'US',
      steamLanguage: 'en',
      currency: 'USD',
      currencySymbol: r'$',
      uiLanguageCode: uiLanguageCode,
      source: source,
    );
  }

  static CountryCatalogEntry? _findByUiLanguage(
    CountryCatalogService catalog,
    String languageCode,
  ) {
    final normalized = normalizeUiLanguageCode(languageCode);
    for (final entry in catalog.countries) {
      if (normalizeUiLanguageCode(entry.uiLanguage) == normalized) {
        return entry;
      }
    }
    return null;
  }

  static String? _deviceUiLanguageCode() {
    try {
      return PlatformDispatcher.instance.locale.languageCode.trim();
    } catch (_) {
      return null;
    }
  }

  static String? _geoGuessMemo;
  static DateTime? _geoGuessMemoAt;

  static Future<String?> _guessCountryFromEdgeOnce() async {
    if (_geoGuessMemo != null && _geoGuessMemoAt != null) {
      if (DateTime.now().difference(_geoGuessMemoAt!) <
          const Duration(hours: 24)) {
        return _geoGuessMemo;
      }
    }
    final g = await ClientRegionClient.fetchGuess();
    _geoGuessMemo = g;
    _geoGuessMemoAt = DateTime.now();
    return g;
  }

  static AppCountryContext resolveSync() {
    final catalog = CountryCatalogService.instance;
    final manual = StorageService.instance.getAppCountrySync();
    if (manual != null) {
      final e = catalog.findByCountryCode(manual);
      if (e != null) {
        return _fromEntry(entry: e, source: 'sync');
      }
    }
    final d = catalog.findDefault();
    if (d != null) {
      return _fromEntry(entry: d, source: 'sync');
    }
    return _fallback(uiLanguageCode: 'en', source: 'fallback');
  }

  static Future<AppCountryContext> resolveContext() async {
    await StorageService.instance.migratePriceRegionToAppCountryOnce();
    await CountryCatalogService.instance.ensureLoaded(ApiConstants.baseUrl);
    final catalog = CountryCatalogService.instance;
    final storage = StorageService.instance;
    var manual = await storage.getAppCountry();
    if (manual == null || manual.isEmpty) {
      final preferredLocale = await storage.getPreferredLocale();
      if (preferredLocale != null && preferredLocale.trim().isNotEmpty) {
        final inferred = _findByUiLanguage(catalog, preferredLocale);
        if (inferred != null) {
          await storage.setAppCountry(inferred.countryCode);
          manual = inferred.countryCode;
        }
      }
    }
    if (manual == null || manual.isEmpty) {
      final devLang = _deviceUiLanguageCode();
      if (devLang != null && devLang.isNotEmpty) {
        final inferred = _findByUiLanguage(catalog, devLang);
        if (inferred != null) {
          await storage.setAppCountry(inferred.countryCode);
          manual = inferred.countryCode;
        }
      }
    }
    if (manual == null || manual.isEmpty) {
      final guess = await _guessCountryFromEdgeOnce();
      if (guess != null && guess.length == 2) {
        if (catalog.findByCountryCode(guess) != null) {
          await storage.setAppCountry(guess);
          manual = guess;
        }
      }
    }
    if (manual != null && manual.isNotEmpty) {
      final e = catalog.findByCountryCode(manual);
      if (e != null) {
        return _fromEntry(entry: e, source: 'manual');
      }
    }

    final d = catalog.findDefault();
    if (d != null) {
      return _fromEntry(entry: d, source: 'default');
    }
    final f = catalog.findFallback();
    if (f != null) {
      return _fromEntry(entry: f, source: 'fallback');
    }
    return _fallback(uiLanguageCode: 'en', source: 'fallback');
  }
}
