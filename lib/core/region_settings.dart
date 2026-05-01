class RegionSettings {
  final List<String> enabledCountries;
  final String defaultCountry;
  final String fallbackCountry;
  final Map<String, String> countryCurrencyMap;
  final Map<String, String> countryLanguageMap;
  final List<String> priceSources;
  final int cacheHours;
  final bool showKeyshopDeals;
  final bool showRegionWarning;

  const RegionSettings({
    required this.enabledCountries,
    required this.defaultCountry,
    required this.fallbackCountry,
    required this.countryCurrencyMap,
    required this.countryLanguageMap,
    required this.priceSources,
    required this.cacheHours,
    required this.showKeyshopDeals,
    required this.showRegionWarning,
  });

  static const RegionSettings defaults = RegionSettings(
    enabledCountries: ['US', 'IN', 'JP', 'BR', 'PL', 'FR', 'DE', 'CN'],
    defaultCountry: 'US',
    fallbackCountry: 'US',
    countryCurrencyMap: {
      'US': 'USD',
      'IN': 'INR',
      'JP': 'JPY',
      'BR': 'BRL',
      'PL': 'PLN',
      'FR': 'EUR',
      'DE': 'EUR',
      'CN': 'CNY',
    },
    countryLanguageMap: {
      'US': 'en',
      'IN': 'en',
      'JP': 'ja',
      'BR': 'pt',
      'PL': 'pl',
      'FR': 'fr',
      'DE': 'de',
      'CN': 'zh',
    },
    priceSources: ['steam', 'itad', 'ggdeals', 'cheapshark'],
    cacheHours: 6,
    showKeyshopDeals: true,
    showRegionWarning: true,
  );

  factory RegionSettings.fromJson(Map<String, dynamic>? raw) {
    if (raw == null) return defaults;
    final enabled = (raw['enabledCountries'] is List ? raw['enabledCountries'] as List<dynamic> : const <dynamic>[])
        .map((e) => '$e'.trim().toUpperCase())
        .where((e) => RegExp(r'^[A-Z]{2}$').hasMatch(e))
        .toSet()
        .toList();
    final enabledCountries = enabled.isEmpty ? [...defaults.enabledCountries] : enabled;
    final fallback = '${
      raw['fallbackCountry'] ?? defaults.fallbackCountry
    }'.trim().toUpperCase();
    final fallbackCountry = enabledCountries.contains(fallback) ? fallback : defaults.fallbackCountry;
    final def = '${raw['defaultCountry'] ?? defaults.defaultCountry}'.trim().toUpperCase();
    final defaultCountry = enabledCountries.contains(def) ? def : fallbackCountry;

    Map<String, String> pickMap(String key, Map<String, String> defaultsMap, bool upper) {
      final source = raw[key];
      final out = <String, String>{};
      if (source is Map) {
        source.forEach((k, v) {
          final kk = '$k'.trim().toUpperCase();
          if (!enabledCountries.contains(kk)) return;
          out[kk] = upper ? '$v'.trim().toUpperCase() : '$v'.trim().toLowerCase();
        });
      }
      for (final c in enabledCountries) {
        out[c] = out[c] ?? defaultsMap[c] ?? (upper ? 'USD' : 'en');
      }
      return out;
    }

    final priceSources = (raw['priceSources'] is List ? raw['priceSources'] as List<dynamic> : const <dynamic>[])
        .map((e) => '$e'.trim().toLowerCase())
        .where((e) => e.isNotEmpty)
        .toSet()
        .toList();
    final cacheHoursRaw = raw['cacheHours'];
    final cacheHours = cacheHoursRaw is num ? cacheHoursRaw.round().clamp(1, 168) : defaults.cacheHours;

    return RegionSettings(
      enabledCountries: enabledCountries,
      defaultCountry: defaultCountry,
      fallbackCountry: fallbackCountry,
      countryCurrencyMap: pickMap('countryCurrencyMap', defaults.countryCurrencyMap, true),
      countryLanguageMap: pickMap('countryLanguageMap', defaults.countryLanguageMap, false),
      priceSources: priceSources.isEmpty ? [...defaults.priceSources] : priceSources,
      cacheHours: cacheHours.toInt(),
      showKeyshopDeals: raw['showKeyshopDeals'] is bool ? raw['showKeyshopDeals'] as bool : defaults.showKeyshopDeals,
      showRegionWarning:
          raw['showRegionWarning'] is bool ? raw['showRegionWarning'] as bool : defaults.showRegionWarning,
    );
  }

  Map<String, dynamic> toJson() => {
        'enabledCountries': enabledCountries,
        'defaultCountry': defaultCountry,
        'fallbackCountry': fallbackCountry,
        'countryCurrencyMap': countryCurrencyMap,
        'countryLanguageMap': countryLanguageMap,
        'priceSources': priceSources,
        'cacheHours': cacheHours,
        'showKeyshopDeals': showKeyshopDeals,
        'showRegionWarning': showRegionWarning,
      };
}

