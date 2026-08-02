import 'dart:convert';

import 'package:http/http.dart' as http;

import 'app_remote_config.dart';
import 'constants/api_constants.dart';
import 'storage_service.dart';
import 'utils/steam_ui_language.dart';

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
    required this.uiLanguage,
    required this.itadCountry,
    required this.ggDealsRegion,
    required this.cheapsharkCountry,
  });

  final String countryCode;
  final String countryName;
  final String? nativeName;
  final String steamCc;
  final String steamLanguage;
  final String defaultCurrency;
  final String currencySymbol;
  final String uiLanguage;
  /// 与后端 ITAD `country` 对齐（ISO2 大写）
  final String itadCountry;
  /// 与 GG.deals `region` 对齐（通常小写）
  final String ggDealsRegion;
  /// 与 CheapShark `country` 查询参数对齐（ISO2 大写）
  final String cheapsharkCountry;

  factory CountryCatalogEntry.fromJson(Map<String, dynamic> m) {
    final steamLanguage = (m['steamLanguage'] ?? 'en').toString();
    final uiLanguageRaw = (m['uiLanguage'] ?? '').toString().trim();
    final cc =
        (m['countryCode'] ?? '').toString().trim().toUpperCase();
    final uiLanguage = resolveCatalogUiLanguage(
      countryCode: cc,
      apiUiLanguage: uiLanguageRaw,
      steamLanguage: steamLanguage,
    );
    String iso2Upper(dynamic v) {
      final s = (v ?? cc).toString().trim().toUpperCase();
      return s.length == 2 ? s : cc;
    }

    String ggRegion(dynamic v) {
      final s = (v ?? '').toString().trim().toLowerCase();
      if (s.length >= 2) return s.substring(0, 2);
      return cc.toLowerCase();
    }

    return CountryCatalogEntry(
      countryCode: cc,
      countryName: (m['countryName'] ?? '').toString(),
      nativeName: m['nativeName']?.toString(),
      steamCc: (m['steamCc'] ?? cc).toString().trim().toUpperCase(),
      steamLanguage: steamLanguage,
      defaultCurrency:
          (m['defaultCurrency'] ?? 'USD').toString().trim().toUpperCase(),
      currencySymbol: (m['currencySymbol'] ?? m['currency_symbol'] ?? '')
          .toString()
          .trim(),
      uiLanguage: uiLanguage,
      itadCountry: iso2Upper(m['itadCountry']),
      ggDealsRegion: ggRegion(m['ggDealsRegion']),
      cheapsharkCountry: iso2Upper(m['cheapsharkCountry']),
    );
  }
}

class CountryCatalogService {
  CountryCatalogService._();
  static final CountryCatalogService instance = CountryCatalogService._();

  String defaultCountry = 'US';
  String fallbackCountry = 'US';
  /// 与后端 `data.clientRegionCountryCode` 一致；由边缘头推断，无则 null（原独立 `/v1/config/client-region` 已并入 countries）。
  String? clientRegionCountryCode;
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
    final guessObj = data['clientRegionCountryCode'] ?? data['countryCode'];
    if (guessObj != null) {
      final guessRaw = guessObj.toString().trim();
      clientRegionCountryCode =
          guessRaw.length == 2 ? guessRaw.toUpperCase() : null;
    } else {
      clientRegionCountryCode = null;
    }
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
    _syncRegionToAppRemote();
  }

  /// 与 `/api/config` 旧 CSV/JSON 等价：完全由本接口返回的 `countries[]` 推导（顺序即 sort）。
  void _syncRegionToAppRemote() {
    final codes = <String>[];
    final langMap = <String, String>{};
    final curMap = <String, String>{};
    for (final e in countries) {
      codes.add(e.countryCode);
      curMap[e.countryCode] = e.defaultCurrency;
      final lk = _languageMapKey(e);
      if (lk != null && !langMap.containsKey(lk)) {
        langMap[lk] = e.countryCode;
      }
    }
    AppRemoteConfig.instance.setDerivedRegionFromCountryCatalog(
      supportedCountryCodesInOrder: codes,
      languageCodeToCountry: langMap,
      countryCodeToCurrency: curMap,
    );
  }

  /** 与后端 `inferUiLanguage` + 前两字母规则对齐，用于 UI 语言 → 默认价格国。 */
  String? _languageMapKey(CountryCatalogEntry e) {
    final u = e.uiLanguage.trim().toLowerCase();
    if (u.isEmpty) return null;
    var primary = u.split(RegExp(r'[-_]')).first;
    if (primary.startsWith('zh')) primary = 'zh';
    if (primary == 'schinese' || primary == 'tchinese') primary = 'zh';
    if (primary.length < 2) return null;
    return primary.substring(0, 2).toUpperCase();
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
    clientRegionCountryCode = null;
    countries = <CountryCatalogEntry>[
      CountryCatalogEntry(
        countryCode: 'US',
        countryName: 'United States',
        nativeName: null,
        steamCc: 'US',
        steamLanguage: 'en',
        defaultCurrency: 'USD',
        currencySymbol: r'$',
        uiLanguage: 'en',
        itadCountry: 'US',
        ggDealsRegion: 'us',
        cheapsharkCountry: 'US',
      ),
    ];
  }
}
