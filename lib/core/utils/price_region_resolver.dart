import 'dart:ui' as ui;

import '../app_remote_config.dart';
import '../storage_service.dart';

class PriceRegionContext {
  final String country;
  final String currency;
  final String language;
  final bool showRegionWarning;
  final bool showKeyshopDeals;
  final String source; // manual / device / default / fallback

  const PriceRegionContext({
    required this.country,
    required this.currency,
    required this.language,
    required this.showRegionWarning,
    required this.showKeyshopDeals,
    required this.source,
  });
}

class PriceRegionResolver {
  static const _defaultCountry = 'US';

  static PriceRegionContext resolveSync() {
    final cfg = AppRemoteConfig.instance.regionSettings;
    final active =
        AppRemoteConfig.instance.activePriceRegion.trim().toUpperCase();
    final country = active.isNotEmpty ? active : _defaultCountry;
    final currency = cfg.countryCurrencyMap[country] ?? 'USD';
    final language = cfg.countryLanguageMap[country] ?? 'en';
    return PriceRegionContext(
      country: country,
      currency: currency,
      language: language,
      showRegionWarning: cfg.showRegionWarning,
      showKeyshopDeals: cfg.showKeyshopDeals,
      source: 'sync',
    );
  }

  static Future<PriceRegionContext> resolveContext() async {
    final cfg = AppRemoteConfig.instance.regionSettings;
    final enabled = cfg.enabledCountries.toSet();

    final manual = (await StorageService.instance.getSelectedPriceRegion())
            ?.trim()
            .toUpperCase() ??
        '';
    if (manual.isNotEmpty && enabled.contains(manual)) {
      AppRemoteConfig.instance.setActivePriceRegion(manual);
      return PriceRegionContext(
        country: manual,
        currency: cfg.countryCurrencyMap[manual] ?? 'USD',
        language: cfg.countryLanguageMap[manual] ?? 'en',
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
        currency: cfg.countryCurrencyMap[localeCountry] ?? 'USD',
        language: cfg.countryLanguageMap[localeCountry] ?? 'en',
        showRegionWarning: cfg.showRegionWarning,
        showKeyshopDeals: cfg.showKeyshopDeals,
        source: 'device_country',
      );
    }

    final localeLanguage = locale.languageCode.trim().toLowerCase();
    if (localeLanguage.isNotEmpty) {
      for (final entry in cfg.countryLanguageMap.entries) {
        if (entry.value.trim().toLowerCase() == localeLanguage &&
            enabled.contains(entry.key)) {
          AppRemoteConfig.instance.setActivePriceRegion(entry.key);
          return PriceRegionContext(
            country: entry.key,
            currency: cfg.countryCurrencyMap[entry.key] ?? 'USD',
            language: cfg.countryLanguageMap[entry.key] ?? 'en',
            showRegionWarning: cfg.showRegionWarning,
            showKeyshopDeals: cfg.showKeyshopDeals,
            source: 'device_language',
          );
        }
      }
    }

    final defaultCountry = cfg.defaultCountry.trim().toUpperCase();
    if (defaultCountry.isNotEmpty && enabled.contains(defaultCountry)) {
      AppRemoteConfig.instance.setActivePriceRegion(defaultCountry);
      return PriceRegionContext(
        country: defaultCountry,
        currency: cfg.countryCurrencyMap[defaultCountry] ?? 'USD',
        language: cfg.countryLanguageMap[defaultCountry] ?? 'en',
        showRegionWarning: cfg.showRegionWarning,
        showKeyshopDeals: cfg.showKeyshopDeals,
        source: 'default',
      );
    }

    final fallback = cfg.fallbackCountry.trim().toUpperCase();
    if (fallback.isNotEmpty && enabled.contains(fallback)) {
      AppRemoteConfig.instance.setActivePriceRegion(fallback);
      return PriceRegionContext(
        country: fallback,
        currency: cfg.countryCurrencyMap[fallback] ?? 'USD',
        language: cfg.countryLanguageMap[fallback] ?? 'en',
        showRegionWarning: cfg.showRegionWarning,
        showKeyshopDeals: cfg.showKeyshopDeals,
        source: 'fallback',
      );
    }

    AppRemoteConfig.instance.setActivePriceRegion(_defaultCountry);
    return PriceRegionContext(
      country: _defaultCountry,
      currency: 'USD',
      language: cfg.countryLanguageMap[_defaultCountry] ?? 'en',
      showRegionWarning: cfg.showRegionWarning,
      showKeyshopDeals: cfg.showKeyshopDeals,
      source: 'fallback',
    );
  }

  static Future<String> resolve() async {
    return (await resolveContext()).country;
  }
}
