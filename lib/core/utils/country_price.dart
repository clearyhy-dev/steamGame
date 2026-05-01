import 'package:intl/intl.dart';

import '../app_remote_config.dart';
import 'price_region_resolver.dart';

class CountryPrice {
  static Set<String> get supportedCountries => AppRemoteConfig.instance.regionSettings.enabledCountries.toSet();
  static Map<String, String> get _countryCurrency => AppRemoteConfig.instance.countryCurrencyMap;

  static String resolveCountryCode() {
    final cc = PriceRegionResolver.resolveSync().toUpperCase();
    if (supportedCountries.contains(cc)) return cc;
    return AppRemoteConfig.instance.regionSettings.defaultCountry.toUpperCase();
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

