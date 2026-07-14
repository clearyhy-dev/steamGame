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

  static Future<void> applyServerCountryIfPresent() async {
    final token = await StorageService.instance.getSteamBackendToken();
    if (token == null || token.isEmpty) return;
    try {
      final me = await SteamBackendService().getMe(token);
      final cc = me['countryCode']?.toString().trim().toUpperCase();
      if (cc != null && cc.length == 2) {
        await StorageService.instance.setAppCountry(cc);
      }
    } catch (_) {}
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
    await applyServerCountryIfPresent();
    await syncCountryToServer();
    await migrateLocalFavoritesOnce();
  }
}
