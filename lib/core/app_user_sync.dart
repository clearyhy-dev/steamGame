import 'app_country_events.dart';
import 'app_country_resolver.dart';
import 'constants/api_constants.dart';
import 'country_catalog_service.dart';
import 'storage_service.dart';
import '../../services/steam_backend_service.dart';

/// 登录后将本地国家/收藏与服务端对齐。
class AppUserSync {
  AppUserSync._();

  static Future<void> syncCountryToServer({String? countryCode, bool? forceManual}) async {
    final token = await StorageService.instance.getSteamBackendToken();
    if (token == null || token.isEmpty) return;
    final storage = StorageService.instance;
    final cc = (countryCode ??
            (await storage.getAppCountry()) ??
            'US')
        .trim()
        .toUpperCase();
    if (cc.length != 2) return;
    final manualPick = forceManual ?? await storage.getAppCountryManualPick();
    try {
      await SteamBackendService().patchMe(
        token,
        countryCode: cc,
        countrySource: manualPick ? 'manual' : 'locale',
      );
    } catch (_) {}
  }

  /// 从 `/api/me` 恢复国家到本地。
  /// - 已登录且服务端有国家时，覆盖默认 US，并锁定 manualPick，避免 Steam/冷启动冲掉
  /// - 本地已手动选的其他国家优先，并回推服务端
  /// 返回：服务端是否已有可用国家（本地已对齐）
  static Future<bool> applyServerCountryIfPresent({bool notifyUi = true}) async {
    final token = await StorageService.instance.getSteamBackendToken();
    if (token == null || token.isEmpty) return false;
    try {
      final me = await SteamBackendService().getMe(token);
      final cc = me['countryCode']?.toString().trim().toUpperCase();
      if (cc == null || cc.length != 2) return false;

      final storage = StorageService.instance;
      final local = (await storage.getAppCountry())?.trim().toUpperCase();
      final manualPick = await storage.getAppCountryManualPick();

      // 本地手动锁了别的国家：保留本地并回推
      if (manualPick && local != null && local.length == 2 && local != cc) {
        await syncCountryToServer(countryCode: local, forceManual: true);
        return true;
      }

      await CountryCatalogService.instance.ensureLoaded(ApiConstants.baseUrl);
      if (CountryCatalogService.instance.findByCountryCode(cc) == null) {
        return false;
      }

      final changed = local != cc;
      if (changed) {
        await storage.setAppCountry(cc);
      }
      // 账号上已有国家 → 锁定，下次冷启动不再掉回 US / 不被 Steam 覆盖
      await storage.setAppCountryManualPick(true);

      if (notifyUi && changed) {
        final ctx = await AppCountryResolver.resolveContext();
        AppCountryEvents.instance.notifyChanged(ctx);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  static Future<void> migrateLocalFavoritesOnce() async {
    final storage = StorageService.instance;
    if (await storage.getFavoritesMigratedV1()) return;
    final token = await storage.getSteamBackendToken();
    if (token == null || token.isEmpty) return;
    final local = await storage.getWishlistItems();
    if (local.isEmpty) {
      await storage.setFavoritesMigratedV1(true);
      return;
    }
    try {
      final items = local
          .map((w) => {
                'appid': w.appId,
                'name': w.name,
                'headerImage': w.image,
                'source': 'manual',
              })
          .toList();
      await SteamBackendService().migrateFavorites(token, items);
      await storage.setFavoritesMigratedV1(true);
    } catch (_) {}
  }

  static Future<void> afterAuthLogin() async {
    final hasServerCountry = await applyServerCountryIfPresent(notifyUi: true);
    if (!hasServerCountry) {
      final local = await StorageService.instance.getAppCountry();
      if (local != null && local.trim().length == 2) {
        await syncCountryToServer();
      }
    }
    await migrateLocalFavoritesOnce();
  }
}
