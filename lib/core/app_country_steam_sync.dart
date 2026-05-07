import 'country_catalog_service.dart';
import '../data/services/cache_service.dart' as hive_cache;
import 'app_country_events.dart';
import 'app_country_resolver.dart';
import 'constants/api_constants.dart';
import 'notification_service.dart';
import 'storage_service.dart';
import '../services/steam_backend_service.dart';

/// Steam 绑定后根据国家资料更新应用国家。
/// 默认跟随 Steam 国家；若用户手动选择过国家（manualPick=true）则不覆盖。
class AppCountrySteamSync {
  AppCountrySteamSync._();

  /// 绑定成功或启动恢复 token 时调用；不会改变用户已锁定的手动选区。
  static Future<void> applyFromSteamOverviewIfEligible(String token) async {
    final t = token.trim();
    if (t.isEmpty) return;

    final storage = StorageService.instance;
    final manualPick = await storage.getAppCountryManualPick();
    if (manualPick) return;

    try {
      final backend = SteamBackendService();
      // `country` 仅影响可变价字段；`extended.countryCode` 与国别无关，固定传 US 即可。
      final overview = await backend.getSteamOverview(t, country: 'US');
      final ext = overview['extended'] as Map<String, dynamic>?;
      final steamCc =
          ext?['countryCode']?.toString().trim().toUpperCase() ?? '';
      if (steamCc.length != 2) return;

      await CountryCatalogService.instance.ensureLoaded(ApiConstants.baseUrl);
      final cat = CountryCatalogService.instance;
      if (cat.findByCountryCode(steamCc) == null) return;

      final current = await storage.getAppCountry();
      if (current == steamCc) return;

      await storage.setAppCountry(steamCc);
      await storage.clearAppCountryScopedCaches();
      await hive_cache.CacheService.clearLastCheckTime();
      await storage.clearLastDailyTaskScheduledAt();
      await storage.clearLastWishlistTaskScheduledAt();
      await NotificationService.instance.rescheduleDaily();
      final ctx = await AppCountryResolver.resolveContext();
      AppCountryEvents.instance.notifyChanged(ctx);
    } catch (_) {}
  }
}
