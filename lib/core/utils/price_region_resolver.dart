import 'dart:ui' as ui;

import '../app_remote_config.dart';
import '../constants/api_constants.dart';
import '../country_catalog_service.dart';
import '../storage_service.dart';
import 'steam_ui_language.dart';

class PriceRegionContext {
  final String country;
  final String currency;

  /// App UI language (ISO 639-1), e.g. en/zh/ja. Independent from price country.
  final String uiLanguageCode;
  final bool showRegionWarning;
  final bool showKeyshopDeals;
  final String source; // manual / device / default / fallback

  const PriceRegionContext({
    required this.country,
    required this.currency,
    required this.uiLanguageCode,
    required this.showRegionWarning,
    required this.showKeyshopDeals,
    required this.source,
  });
}

class PriceRegionResolver {
  static const _defaultCountry = 'US';

  static String _syncUiLanguageCode() {
    final stored = StorageService.instance.getPreferredLocaleSync();
    if (stored != null && stored.trim().isNotEmpty) {
      return normalizeUiLanguageCode(stored);
    }
    final loc = ui.PlatformDispatcher.instance.locale;
    return normalizeUiLanguageCode(loc.languageCode);
  }

  static PriceRegionContext resolveSync() {
    final cfg = AppRemoteConfig.instance.regionSettings;
    final catalog = CountryCatalogService.instance;
    final active =
        AppRemoteConfig.instance.activePriceRegion.trim().toUpperCase();
    final country = active.isNotEmpty ? active : _defaultCountry;
    final currency = catalog.defaultCurrencyFor(country) ??
        cfg.countryCurrencyMap[country] ??
        'USD';
    final uiLang = _syncUiLanguageCode();
    return PriceRegionContext(
      country: country,
      currency: currency,
      uiLanguageCode: uiLang,
      showRegionWarning: cfg.showRegionWarning,
      showKeyshopDeals: cfg.showKeyshopDeals,
      source: 'sync',
    );
  }

  static Future<PriceRegionContext> resolveContext() async {
    await StorageService.instance.migratePriceRegionToAppCountryOnce();
    await CountryCatalogService.instance.ensureLoaded(ApiConstants.baseUrl);
    final catalog = CountryCatalogService.instance;
    final cfg = AppRemoteConfig.instance.regionSettings;
    final enabled = catalog.countryCodes.isNotEmpty
        ? catalog.countryCodes
        : cfg.enabledCountries.toSet();
    final storedUi = await StorageService.instance.getPreferredLocale();
    final uiLang = normalizeUiLanguageCode(
        storedUi ?? ui.PlatformDispatcher.instance.locale.languageCode);

    final manual = (await StorageService.instance.getAppCountry())?.trim() ??
        '';
    if (manual.isNotEmpty && enabled.contains(manual)) {
      AppRemoteConfig.instance.setActivePriceRegion(manual);
      return PriceRegionContext(
        country: manual,
        currency: catalog.defaultCurrencyFor(manual) ??
            cfg.countryCurrencyMap[manual] ??
            'USD',
        uiLanguageCode: uiLang,
        showRegionWarning: cfg.showRegionWarning,
        showKeyshopDeals: cfg.showKeyshopDeals,
        source: 'manual',
      );
    }

    final locale = ui.PlatformDispatcher.instance.locale;
    final localeCountry = (locale.countryCode ?? '').trim().toUpperCase();
    if (localeCountry.isNotEmpty && enabled.contains(localeCountry)) {
      AppRemoteConfig.instance.setActivePriceRegion(localeCountry);
      return PriceRegionContext(
        country: localeCountry,
        currency: catalog.defaultCurrencyFor(localeCountry) ??
            cfg.countryCurrencyMap[localeCountry] ??
            'USD',
        uiLanguageCode: uiLang,
        showRegionWarning: cfg.showRegionWarning,
        showKeyshopDeals: cfg.showKeyshopDeals,
        source: 'device_country',
      );
    }

    var defaultCountry = catalog.defaultCountry.trim().toUpperCase();
    if (defaultCountry.isEmpty) {
      defaultCountry = cfg.defaultCountry.trim().toUpperCase();
    }
    if (defaultCountry.isNotEmpty && enabled.contains(defaultCountry)) {
      AppRemoteConfig.instance.setActivePriceRegion(defaultCountry);
      return PriceRegionContext(
        country: defaultCountry,
        currency: catalog.defaultCurrencyFor(defaultCountry) ??
            cfg.countryCurrencyMap[defaultCountry] ??
            'USD',
        uiLanguageCode: uiLang,
        showRegionWarning: cfg.showRegionWarning,
        showKeyshopDeals: cfg.showKeyshopDeals,
        source: 'default',
      );
    }

    var fallback = catalog.fallbackCountry.trim().toUpperCase();
    if (fallback.isEmpty) {
      fallback = cfg.fallbackCountry.trim().toUpperCase();
    }
    if (fallback.isNotEmpty && enabled.contains(fallback)) {
      AppRemoteConfig.instance.setActivePriceRegion(fallback);
      return PriceRegionContext(
        country: fallback,
        currency: catalog.defaultCurrencyFor(fallback) ??
            cfg.countryCurrencyMap[fallback] ??
            'USD',
        uiLanguageCode: uiLang,
        showRegionWarning: cfg.showRegionWarning,
        showKeyshopDeals: cfg.showKeyshopDeals,
        source: 'fallback',
      );
    }

    AppRemoteConfig.instance.setActivePriceRegion(_defaultCountry);
    return PriceRegionContext(
      country: _defaultCountry,
      currency: catalog.defaultCurrencyFor(_defaultCountry) ?? 'USD',
      uiLanguageCode: uiLang,
      showRegionWarning: cfg.showRegionWarning,
      showKeyshopDeals: cfg.showKeyshopDeals,
      source: 'fallback',
    );
  }

  static Future<String> resolve() async {
    return (await resolveContext()).country;
  }
}
