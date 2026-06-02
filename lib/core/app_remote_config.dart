import 'dart:convert';

import 'package:http/http.dart' as http;
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
  /// 与 GET `/api/config` 的 `publicCacheCdnBase` 一致：GCS/Cloud CDN 根（无尾斜杠），用于 `cache/*.json`。
  String? publicCacheCdnBase;
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

  Future<void> _loadFromCache() async {
    final cached = await StorageService.instance.getRemoteConfigCache();
    if (cached == null || cached.isEmpty) return;
    _applyData(cached);
  }

  void _applyData(Map<String, dynamic> data) {
    publicAppBaseUrl = data['appBaseUrl'] as String?;
    final cacheBase = data['publicCacheCdnBase'] as String?;
    if (cacheBase != null && cacheBase.trim().isNotEmpty) {
      publicCacheCdnBase = cacheBase.trim().replaceAll(RegExp(r'/+$'), '');
    } else {
      publicCacheCdnBase = null;
    }
    final ds = data['appDeeplinkScheme'] as String?;
    if (ds != null && ds.trim().isNotEmpty) deeplinkScheme = ds.trim();
    final sh = data['appDeeplinkSuccessHost'] as String?;
    if (sh != null && sh.trim().isNotEmpty) deeplinkSuccessHost = sh.trim();
    final fh = data['appDeeplinkFailHost'] as String?;
    if (fh != null && fh.trim().isNotEmpty) deeplinkFailHost = fh.trim();

    connectTimeoutSec = _int(data['appConnectTimeoutSec'], connectTimeoutSec).clamp(1, 120).toInt();
    receiveTimeoutSec = _int(data['appReceiveTimeoutSec'], receiveTimeoutSec).clamp(5, 600).toInt();

    loaded = true;
  }

  /// 由 [GET /api/v1/config/countries] 返回的 `countries[]` 推导（见 `CountryCatalogService._syncRegionToAppRemote`）。
  void setDerivedRegionFromCountryCatalog({
    required List<String> supportedCountryCodesInOrder,
    required Map<String, String> languageCodeToCountry,
    required Map<String, String> countryCodeToCurrency,
  }) {
    supportedDealCountries = supportedCountryCodesInOrder;
    countryMap = languageCodeToCountry.map(
      (k, v) => MapEntry(k.toUpperCase(), v.toUpperCase()),
    );
    countryCurrencyMap = countryCodeToCurrency.map(
      (k, v) => MapEntry(k.toUpperCase(), v.toUpperCase()),
    );
  }

  static int _int(dynamic v, int d) {
    if (v is int) return v;
    if (v is num) return v.round();
    return d;
  }
}
