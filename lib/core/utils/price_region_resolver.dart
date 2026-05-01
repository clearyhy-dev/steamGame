import 'dart:ui' as ui;

import '../app_remote_config.dart';
import '../storage_service.dart';

class PriceRegionResolver {
  static const _defaultCountry = 'US';

  static String resolveSync() {
    final active = AppRemoteConfig.instance.activePriceRegion.trim().toUpperCase();
    if (active.isNotEmpty) return active;
    return _defaultCountry;
  }

  static Future<String> resolve() async {
    final cfg = AppRemoteConfig.instance.regionSettings;
    final enabled = cfg.enabledCountries.toSet();

    final manual = (await StorageService.instance.getSelectedPriceRegion())?.trim().toUpperCase() ?? '';
    if (manual.isNotEmpty && enabled.contains(manual)) {
      AppRemoteConfig.instance.setActivePriceRegion(manual);
      return manual;
    }

    final locale = ui.PlatformDispatcher.instance.locale;
    final localeCountry = (locale.countryCode ?? '').trim().toUpperCase();
    if (localeCountry.isNotEmpty && enabled.contains(localeCountry)) {
      AppRemoteConfig.instance.setActivePriceRegion(localeCountry);
      return localeCountry;
    }

    final localeLanguage = locale.languageCode.trim().toLowerCase();
    if (localeLanguage.isNotEmpty) {
      for (final entry in cfg.countryLanguageMap.entries) {
        if (entry.value.trim().toLowerCase() == localeLanguage && enabled.contains(entry.key)) {
          AppRemoteConfig.instance.setActivePriceRegion(entry.key);
          return entry.key;
        }
      }
    }

    final defaultCountry = cfg.defaultCountry.trim().toUpperCase();
    if (defaultCountry.isNotEmpty && enabled.contains(defaultCountry)) {
      AppRemoteConfig.instance.setActivePriceRegion(defaultCountry);
      return defaultCountry;
    }

    final fallback = cfg.fallbackCountry.trim().toUpperCase();
    if (fallback.isNotEmpty && enabled.contains(fallback)) {
      AppRemoteConfig.instance.setActivePriceRegion(fallback);
      return fallback;
    }

    AppRemoteConfig.instance.setActivePriceRegion(_defaultCountry);
    return _defaultCountry;
  }
}

