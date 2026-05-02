import '../app_remote_config.dart';
import '../app_country_resolver.dart';

class PriceRegionContext {
  final String country;
  final String currency;

  /// App UI language (ISO 639-1), e.g. en/zh/ja. Independent from price country.
  final String uiLanguageCode;
  final bool showRegionWarning;
  final bool showKeyshopDeals;
  final String source; // manual / device / default / fallback

  const PriceRegionContext({
    required this.country,
    required this.currency,
    required this.uiLanguageCode,
    required this.showRegionWarning,
    required this.showKeyshopDeals,
    required this.source,
  });
}

class PriceRegionResolver {
  static PriceRegionContext resolveSync() {
    final app = AppCountryResolver.resolveSync();
    final cfg = AppRemoteConfig.instance.regionSettings;
    return PriceRegionContext(
      country: app.countryCode,
      currency: app.currency,
      uiLanguageCode: app.uiLanguageCode,
      showRegionWarning: cfg.showRegionWarning,
      showKeyshopDeals: false,
      source: 'sync',
    );
  }

  static Future<PriceRegionContext> resolveContext() async {
    final app = await AppCountryResolver.resolveContext();
    final cfg = AppRemoteConfig.instance.regionSettings;
    return PriceRegionContext(
      country: app.countryCode,
      currency: app.currency,
      uiLanguageCode: app.uiLanguageCode,
      showRegionWarning: cfg.showRegionWarning,
      showKeyshopDeals: false,
      source: app.source,
    );
  }

  static Future<String> resolve() async {
    return (await resolveContext()).country;
  }
}
