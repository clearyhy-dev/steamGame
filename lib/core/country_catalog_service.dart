import 'dart:convert';

import 'package:http/http.dart' as http;

import 'app_remote_config.dart';
import 'constants/api_constants.dart';
import 'storage_service.dart';

/// Backend `/api/v1/config/countries` — enabled countries + default/fallback ISO codes.
class CountryCatalogEntry {
  CountryCatalogEntry({
    required this.countryCode,
    required this.countryName,
    this.nativeName,
    required this.steamCc,
    required this.steamLanguage,
    required this.defaultCurrency,
    required this.currencySymbol,
  });

  final String countryCode;
  final String countryName;
  final String? nativeName;
  final String steamCc;
  final String steamLanguage;
  final String defaultCurrency;
  final String currencySymbol;

  factory CountryCatalogEntry.fromJson(Map<String, dynamic> m) {
    return CountryCatalogEntry(
      countryCode: (m['countryCode'] ?? '').toString().trim().toUpperCase(),
      countryName: (m['countryName'] ?? '').toString(),
      nativeName: m['nativeName']?.toString(),
      steamCc: (m['steamCc'] ?? '').toString().trim().toUpperCase(),
      steamLanguage: (m['steamLanguage'] ?? 'en').toString(),
      defaultCurrency:
          (m['defaultCurrency'] ?? 'USD').toString().trim().toUpperCase(),
      currencySymbol: (m['currencySymbol'] ?? m['currency_symbol'] ?? '')
          .toString()
          .trim(),
    );
  }
}

class CountryCatalogService {
  CountryCatalogService._();
  static final CountryCatalogService instance = CountryCatalogService._();

  String defaultCountry = 'US';
  String fallbackCountry = 'US';
  List<CountryCatalogEntry> countries = [];

  bool get isLoaded => countries.isNotEmpty;

  Set<String> get countryCodes =>
      countries.map((e) => e.countryCode).toSet();

  CountryCatalogEntry? findByCountryCode(String countryCode) {
    final c = countryCode.trim().toUpperCase();
    for (final e in countries) {
      if (e.countryCode == c) return e;
    }
    return null;
  }

  CountryCatalogEntry? findDefault() => findByCountryCode(defaultCountry);

  CountryCatalogEntry? findFallback() => findByCountryCode(fallbackCountry);

  String? defaultCurrencyFor(String countryCode) {
    final c = countryCode.trim().toUpperCase();
    for (final e in countries) {
      if (e.countryCode == c) return e.defaultCurrency;
    }
    return null;
  }

  String? currencySymbolFor(String countryCode) {
    final c = countryCode.trim().toUpperCase();
    for (final e in countries) {
      if (e.countryCode == c) {
        final symbol = e.currencySymbol.trim();
        if (symbol.isNotEmpty) return symbol;
      }
    }
    return null;
  }

  void _applyPayload(Map<String, dynamic> data) {
    defaultCountry =
        (data['defaultCountry'] ?? 'US').toString().trim().toUpperCase();
    fallbackCountry =
        (data['fallbackCountry'] ?? 'US').toString().trim().toUpperCase();
    final raw = data['countries'];
    if (raw is List) {
      countries = raw
          .whereType<Map>()
          .map((e) =>
              CountryCatalogEntry.fromJson(Map<String, dynamic>.from(e)))
          .where((e) => e.countryCode.length == 2)
          .toList();
    }
    if (countries.isEmpty) {
      _applyBuiltInFallback();
    }
  }

  Future<void> ensureLoaded(String baseUrl) async {
    if (isLoaded) return;
    await load(baseUrl);
  }

  Future<void> load(String baseUrl) async {
    final root = AppRemoteConfig.instance.resolveApiBase(baseUrl);
    final uri = Uri.parse('$root/api/v1/config/countries');
    final cached = await StorageService.instance.getCountryCatalogCache();
    if (cached != null) {
      final data = cached['data'];
      if (data is Map<String, dynamic>) {
        _applyPayload(data);
      } else if (cached.containsKey('countries')) {
        _applyPayload(Map<String, dynamic>.from(cached));
      }
    }
    var loadedFromRemote = false;
    try {
      final res = await http
          .get(uri)
          .timeout(ApiConstants.receiveTimeout, onTimeout: () {
        throw Exception('country catalog timeout');
      });
      if (res.statusCode == 200 && res.body.isNotEmpty) {
        final map = jsonDecode(res.body) as Map<String, dynamic>;
        if (map['success'] == true || map['ok'] == true) {
          final data = map['data'];
          if (data is Map<String, dynamic>) {
            _applyPayload(data);
            loadedFromRemote = true;
            await StorageService.instance.setCountryCatalogCache(map);
          }
        }
      }
    } catch (_) {
      // keep cache / partial state
    }
    if (!loadedFromRemote && countries.isEmpty) {
      _applyBuiltInFallback();
    }
  }

  void _applyBuiltInFallback() {
    defaultCountry = 'US';
    fallbackCountry = 'US';
    countries = <CountryCatalogEntry>[
      CountryCatalogEntry(
        countryCode: 'US',
        countryName: 'United States',
        nativeName: null,
        steamCc: 'US',
        steamLanguage: 'en',
        defaultCurrency: 'USD',
        currencySymbol: r'$',
      ),
    ];
  }
}
