import 'dart:ui';

import '../../services/storage_service.dart';

/// 多语言：优先使用应用内选择的语言，否则按系统国家识别
/// 美国/加拿大/澳大利亚/日本/韩国/中国台湾/德国/法国 等
class LocaleService {
  LocaleService._();

  /// 国家代码到语言代码映射（Google Play 主要市场）
  static const Map<String, String> countryToLang = {
    'US': 'en',
    'AU': 'en',
    'CA': 'en',
    'GB': 'en',
    'NZ': 'en',
    'JP': 'ja',
    'KR': 'ko',
    'TW': 'zh',
    'CN': 'zh',
    'DE': 'de',
    'FR': 'fr',
    'IN': 'en',
    'BR': 'pt',
    'ID': 'id',
  };

  /// 从系统获取国家代码（如 US, JP, KR）
  static String getCountryCode() {
    final code = PlatformDispatcher.instance.locale.countryCode;
    return code?.isNotEmpty == true ? code!.toUpperCase() : 'US';
  }

  /// 根据国家获取语言代码（供 API lang 参数）
  /// 若应用内已选语言则优先使用，否则按系统国家
  static String getLanguageCode() {
    final override = StorageService.languageOverride;
    if (override != null && override.isNotEmpty) return override;
    final country = getCountryCode();
    return countryToLang[country] ?? 'en';
  }
}
