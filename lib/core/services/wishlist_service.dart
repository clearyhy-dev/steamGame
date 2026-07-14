import '../../models/game_model.dart';
import '../../models/wishlist_model.dart';
import '../storage_service.dart';
import '../../services/steam_backend_service.dart';

/// 愿望单：登录态以服务端 `/api/favorites` 为准，本地作离线缓存。
class WishlistService {
  static final WishlistService _instance = WishlistService._internal();
  factory WishlistService() => _instance;
  WishlistService._internal();

  StorageService get _storage => StorageService.instance;
  final SteamBackendService _backend = SteamBackendService();

  Future<String?> _token() => _storage.getSteamBackendToken();

  Future<void> add(GameModel game, {int targetDiscount = 0}) async {
    final item = WishlistItem.fromGame(game, targetDiscount: targetDiscount);
    await _storage.addToWishlist(item);
    final token = await _token();
    if (token == null || token.isEmpty) return;
    try {
      await _backend.addFavorite(
        token: token,
        appid: game.appId,
        name: game.name,
        headerImage: game.image,
        source: 'manual',
      );
    } catch (_) {}
  }

  Future<void> remove(String appId) async {
    await _storage.removeFromWishlist(appId);
    final token = await _token();
    if (token == null || token.isEmpty) return;
    try {
      await _backend.deleteFavorite(token: token, appid: appId);
    } catch (_) {}
  }

  Future<bool> isInWishlist(String appId) async {
    final token = await _token();
    if (token != null && token.isNotEmpty) {
      try {
        final remote = await _backend.listFavorites(token);
        for (final f in remote) {
          if (f is Map && f['appid']?.toString() == appId) return true;
        }
        return false;
      } catch (_) {}
    }
    return _storage.isInWishlist(appId);
  }

  Future<List<WishlistItem>> getWishlist() async {
    final token = await _token();
    if (token != null && token.isNotEmpty) {
      try {
        final remote = await _backend.listFavorites(token);
        final items = <WishlistItem>[];
        for (final f in remote) {
          if (f is! Map) continue;
          final appid = f['appid']?.toString().trim() ?? '';
          if (appid.isEmpty) continue;
          items.add(WishlistItem(
            appId: appid,
            name: f['name']?.toString() ?? appid,
            image: f['headerImage']?.toString() ?? '',
            targetDiscount: 0,
          ));
        }
        return items;
      } catch (_) {}
    }
    return _storage.getWishlistItems();
  }
}
