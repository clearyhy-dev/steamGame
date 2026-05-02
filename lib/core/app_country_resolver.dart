import 'dart:ui' as ui;

import 'constants/api_constants.dart';
import 'country_catalog_service.dart';
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

  static String _syncUiLanguageCode() {
    final stored = StorageService.instance.getPreferredLocaleSync();
    if (stored != null && stored.trim().isNotEmpty) {
      return normalizeUiLanguageCode(stored);
    }
    final loc = ui.PlatformDispatcher.instance.locale;
    return normalizeUiLanguageCode(loc.languageCode);
  }

  static AppCountryContext _fromEntry({
    required CountryCatalogEntry entry,
    required String source,
    required String uiLanguageCode,
  }) {
    return AppCountryContext(
      countryCode: entry.countryCode,
      countryName: entry.countryName,
      steamCc: entry.steamCc,
      steamLanguage: entry.steamLanguage,
      currency: entry.defaultCurrency,
      currencySymbol: entry.currencySymbol,
      uiLanguageCode: uiLanguageCode,
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

  static AppCountryContext resolveSync() {
    final uiLang = _syncUiLanguageCode();
    final catalog = CountryCatalogService.instance;
    final manual = StorageService.instance.getAppCountrySync();
    if (manual != null) {
      final e = catalog.findByCountryCode(manual);
      if (e != null) {
        return _fromEntry(entry: e, source: 'sync', uiLanguageCode: uiLang);
      }
    }
    final d = catalog.findDefault();
    if (d != null) {
      return _fromEntry(entry: d, source: 'sync', uiLanguageCode: uiLang);
    }
    return _fallback(uiLanguageCode: uiLang, source: 'fallback');
  }

  static Future<AppCountryContext> resolveContext() async {
    await StorageService.instance.migratePriceRegionToAppCountryOnce();
    await CountryCatalogService.instance.ensureLoaded(ApiConstants.baseUrl);
    final catalog = CountryCatalogService.instance;
    final storedUi = await StorageService.instance.getPreferredLocale();
    final uiLang = normalizeUiLanguageCode(
      storedUi ?? ui.PlatformDispatcher.instance.locale.languageCode,
    );

    final manual = await StorageService.instance.getAppCountry();
    if (manual != null) {
      final e = catalog.findByCountryCode(manual);
      if (e != null) {
        return _fromEntry(entry: e, source: 'manual', uiLanguageCode: uiLang);
      }
    }

    final localeCountry =
        (ui.PlatformDispatcher.instance.locale.countryCode ?? '').trim();
    if (localeCountry.isNotEmpty) {
      final e = catalog.findByCountryCode(localeCountry);
      if (e != null) {
        return _fromEntry(
          entry: e,
          source: 'device_country',
          uiLanguageCode: uiLang,
        );
      }
    }

    final d = catalog.findDefault();
    if (d != null) {
      return _fromEntry(entry: d, source: 'default', uiLanguageCode: uiLang);
    }
    final f = catalog.findFallback();
    if (f != null) {
      return _fromEntry(entry: f, source: 'fallback', uiLanguageCode: uiLang);
    }
    return _fallback(uiLanguageCode: uiLang, source: 'fallback');
  }
}
