import 'package:intl/intl.dart';

import '../app_remote_config.dart';
import '../constants.dart';
import '../storage_service.dart';

class CountryPrice {
  static Set<String> get supportedCountries => AppRemoteConfig.instance.supportedDealCountries.toSet();
  static Map<String, String> get _countryCurrency => AppRemoteConfig.instance.countryCurrencyMap;
  static Map<String, String> get _localeToCountry => AppRemoteConfig.instance.countryMap;

  static String resolveCountryCode() {
    final storage = StorageService.instance;
    if (!storage.isInitialized) return 'US';
    final raw = (storage.prefs.getString(AppConstants.keyPreferredLocale) ?? '').trim();
    if (raw.isEmpty) return 'US';
    final normalized = raw.replaceAll('-', '_');
    final parts = normalized.split('_').where((e) => e.isNotEmpty).toList();
    final direct = raw.toUpperCase();
    if (supportedCountries.contains(direct)) return direct;
    if (parts.length >= 2) {
      final cc = parts[1].toUpperCase();
      if (supportedCountries.contains(cc)) return cc;
    }
    final locale = (parts.isNotEmpty ? parts.first : raw).toLowerCase();
    return _localeToCountry[locale.toUpperCase()] ?? _localeToCountry[locale] ?? 'US';
  }

  static NumberFormat formatter({String? countryCode}) {
    final cc = (countryCode ?? resolveCountryCode()).toUpperCase();
    final code = _countryCurrency[cc] ?? 'USD';
    return NumberFormat.simpleCurrency(name: code);
  }

  static String format(double value, {String? countryCode, int? decimalDigits}) {
    final f = formatter(countryCode: countryCode);
    if (decimalDigits != null) {
      return NumberFormat.currency(
        name: f.currencyName,
        symbol: f.currencySymbol,
        decimalDigits: decimalDigits,
      ).format(value);
    }
    return f.format(value);
  }
}

