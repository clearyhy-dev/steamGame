import 'dart:convert';

import 'package:http/http.dart' as http;
import 'region_settings.dart';
import 'storage_service.dart';

/// Values from GET `/api/config` (merged Firestore + env on server). Loaded once at startup.
class AppRemoteConfig {
  AppRemoteConfig._();
  static final AppRemoteConfig instance = AppRemoteConfig._();

  String deeplinkScheme = 'myapp';
  String deeplinkSuccessHost = 'auth';
  String deeplinkFailHost = 'auth';
  int connectTimeoutSec = 15;
  int receiveTimeoutSec = 90;
  String? publicAppBaseUrl;
  List<String> supportedDealCountries = const [
    'US', 'CN', 'JP', 'KR', 'HK', 'SG', 'TW', 'GB', 'DE', 'FR', 'CA', 'AU', 'BR', 'RU',
  ];
  Map<String, String> countryMap = const {
    'EN': 'US',
    'ZH': 'CN',
    'JA': 'JP',
    'KO': 'KR',
    'DE': 'DE',
    'FR': 'FR',
    'PT': 'BR',
    'RU': 'RU',
  };
  Map<String, String> countryCurrencyMap = const {
    'US': 'USD',
    'CN': 'CNY',
    'JP': 'JPY',
    'KR': 'KRW',
    'HK': 'HKD',
    'SG': 'SGD',
    'TW': 'TWD',
    'GB': 'GBP',
    'DE': 'EUR',
    'FR': 'EUR',
    'CA': 'CAD',
    'AU': 'AUD',
    'BR': 'BRL',
    'RU': 'RUB',
  };
  RegionSettings regionSettings = RegionSettings.defaults;
  String activePriceRegion = 'US';
  bool loaded = false;

  /// Prefer server-reported [publicAppBaseUrl] after [loadFromBackend], else the compile-time default.
  String resolveApiBase(String compileTimeBase) {
    final p = publicAppBaseUrl;
    if (p != null && p.trim().isNotEmpty) {
      return p.trim().replaceAll(RegExp(r'/+$'), '');
    }
    return compileTimeBase.replaceAll(RegExp(r'/+$'), '');
  }

  Future<void> loadFromBackend(String baseUrl, {http.Client? client}) async {
    final c = client ?? http.Client();
    final root = baseUrl.replaceAll(RegExp(r'/+$'), '');
    final uri = Uri.parse('$root/api/config');
    try {
      await _loadFromCache();
      final res = await c.get(uri).timeout(const Duration(seconds: 6));
      if (res.statusCode != 200) return;
      final map = jsonDecode(res.body) as Map<String, dynamic>;
      if (map['success'] != true) return;
      final data = map['data'] as Map<String, dynamic>?;
      if (data == null) return;
      _applyData(data);
      await StorageService.instance.setRemoteConfigCache(data);
    } catch (_) {
      await _loadFromCache();
    }
  }

  Future<void> loadRegionSettings(String baseUrl, {http.Client? client}) async {
    final c = client ?? http.Client();
    final root = baseUrl.replaceAll(RegExp(r'/+$'), '');
    final uri = Uri.parse('$root/api/v1/config/region-settings');
    try {
      await _loadRegionFromCache();
      final res = await c.get(uri).timeout(const Duration(seconds: 6));
      if (res.statusCode != 200) return;
      final map = jsonDecode(res.body) as Map<String, dynamic>;
      if (map['success'] != true) return;
      final data = map['data'] as Map<String, dynamic>?;
      if (data == null) return;
      _applyRegionData(data);
      await StorageService.instance.setRegionSettingsCache(data);
    } catch (_) {
      await _loadRegionFromCache();
      // final fallback always available
      if (regionSettings.enabledCountries.isEmpty) {
        _applyRegionData(RegionSettings.defaults.toJson());
      }
    }
  }

  Future<void> _loadFromCache() async {
    final cached = await StorageService.instance.getRemoteConfigCache();
    if (cached == null || cached.isEmpty) return;
    _applyData(cached);
  }

  Future<void> _loadRegionFromCache() async {
    final cached = await StorageService.instance.getRegionSettingsCache();
    if (cached == null || cached.isEmpty) return;
    _applyRegionData(cached);
  }

  void _applyData(Map<String, dynamic> data) {
    publicAppBaseUrl = data['appBaseUrl'] as String?;
    final ds = data['appDeeplinkScheme'] as String?;
    if (ds != null && ds.trim().isNotEmpty) deeplinkScheme = ds.trim();
    final sh = data['appDeeplinkSuccessHost'] as String?;
    if (sh != null && sh.trim().isNotEmpty) deeplinkSuccessHost = sh.trim();
    final fh = data['appDeeplinkFailHost'] as String?;
    if (fh != null && fh.trim().isNotEmpty) deeplinkFailHost = fh.trim();

    connectTimeoutSec = _int(data['appConnectTimeoutSec'], connectTimeoutSec).clamp(1, 120).toInt();
    receiveTimeoutSec = _int(data['appReceiveTimeoutSec'], receiveTimeoutSec).clamp(5, 600).toInt();

    final csv = '${data['appSupportedDealCountriesCsv'] ?? ''}'.trim();
    if (csv.isNotEmpty) {
      supportedDealCountries = csv
          .split(',')
          .map((e) => e.trim().toUpperCase())
          .where((e) => e.length == 2)
          .toSet()
          .toList();
    }

    final mapJson = '${data['appCountryMapJson'] ?? ''}'.trim();
    if (mapJson.isNotEmpty) {
      final parsed = _parseStringMap(mapJson);
      if (parsed.isNotEmpty) countryMap = parsed.map((k, v) => MapEntry(k.toUpperCase(), v.toUpperCase()));
    }
    final currencyJson = '${data['appCountryCurrencyMapJson'] ?? ''}'.trim();
    if (currencyJson.isNotEmpty) {
      final parsed = _parseStringMap(currencyJson);
      if (parsed.isNotEmpty) {
        countryCurrencyMap = parsed.map((k, v) => MapEntry(k.toUpperCase(), v.toUpperCase()));
      }
    }
    // Keep old /api/config compatibility: if region settings endpoint has not been loaded yet,
    // sync defaults from existing app-level mapping fields.
    if (regionSettings == RegionSettings.defaults) {
      final enabled = supportedDealCountries.isNotEmpty
          ? supportedDealCountries
          : RegionSettings.defaults.enabledCountries;
      final defaultCountry = enabled.contains('US') ? 'US' : enabled.first;
      regionSettings = RegionSettings(
        enabledCountries: enabled,
        defaultCountry: defaultCountry,
        fallbackCountry: defaultCountry,
        countryCurrencyMap: {
          ...RegionSettings.defaults.countryCurrencyMap,
          ...countryCurrencyMap,
        },
        countryLanguageMap: {
          ...RegionSettings.defaults.countryLanguageMap,
          ...countryMap.map((k, v) => MapEntry(v.toUpperCase(), k.toLowerCase())),
        },
        priceSources: RegionSettings.defaults.priceSources,
        cacheHours: RegionSettings.defaults.cacheHours,
        showKeyshopDeals: RegionSettings.defaults.showKeyshopDeals,
        showRegionWarning: RegionSettings.defaults.showRegionWarning,
      );
    }
    loaded = true;
  }

  void _applyRegionData(Map<String, dynamic> data) {
    regionSettings = RegionSettings.fromJson(data);
    supportedDealCountries = [...regionSettings.enabledCountries];
    countryCurrencyMap = {...regionSettings.countryCurrencyMap};
    final regionCountryMap = <String, String>{};
    regionSettings.countryLanguageMap.forEach((country, lang) {
      regionCountryMap[lang.toUpperCase()] = country.toUpperCase();
    });
    countryMap = {
      ...countryMap,
      ...regionCountryMap,
    };
    if (!regionSettings.enabledCountries.contains(activePriceRegion)) {
      activePriceRegion = regionSettings.defaultCountry;
    }
  }

  void setActivePriceRegion(String countryCode) {
    final c = countryCode.trim().toUpperCase();
    if (regionSettings.enabledCountries.contains(c)) {
      activePriceRegion = c;
    }
  }

  static Map<String, String> _parseStringMap(String raw) {
    try {
      final decoded = jsonDecode(raw);
      if (decoded is Map) {
        final out = <String, String>{};
        decoded.forEach((k, v) {
          out[k.toString()] = v.toString();
        });
        return out;
      }
    } catch (_) {}
    return {};
  }

  static int _int(dynamic v, int d) {
    if (v is int) return v;
    if (v is num) return v.round();
    return d;
  }
}
