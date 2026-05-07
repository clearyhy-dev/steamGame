import '../app_country_resolver.dart';
import '../storage_service.dart';

class PriceRegionContext {
  final String country;
  final String currency;

  /// App UI language from [AppCountryResolver] / country catalog `uiLanguage`.
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
    return PriceRegionContext(
      country: app.countryCode,
      currency: app.currency,
      uiLanguageCode: app.uiLanguageCode,
      showRegionWarning: false,
      showKeyshopDeals: false,
      source: 'sync',
    );
  }

  static Future<PriceRegionContext> resolveContext() async {
    final app = await AppCountryResolver.resolveContext();
    return PriceRegionContext(
      country: app.countryCode,
      currency: app.currency,
      uiLanguageCode: app.uiLanguageCode,
      showRegionWarning: false,
      showKeyshopDeals: false,
      source: app.source,
    );
  }

  static Future<String> resolve() async {
    return (await resolveContext()).country;
  }

  /// Preferred locale (user-selected UI language), else catalog [uiLanguageCode] — for Steam `l` / backend `language`.
  static Future<String> effectiveSteamUiLanguage() async {
    try {
      final stored = StorageService.instance.getPreferredLocaleSync();
      if (stored != null && stored.trim().isNotEmpty) {
        return stored.trim().toLowerCase();
      }
    } catch (_) {}
    final ctx = await resolveContext();
    final c = ctx.uiLanguageCode.trim().toLowerCase();
    return c.isEmpty ? 'en' : c;
  }
}
