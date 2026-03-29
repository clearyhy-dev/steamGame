import 'game_model.dart';

/// 支持的比价商店标识（与联盟后台对齐）。
abstract final class StoreIds {
  static const String steam = 'steam';
  static const String fanatical = 'fanatical';
  static const String gmg = 'gmg';
  static const String cdkeys = 'cdkeys';
}

/// 单店报价 + 联盟跳转（V1 Mock，上线前替换真实 affiliate 链接）。
class StoreOffer {
  const StoreOffer({
    required this.gameId,
    required this.store,
    required this.price,
    required this.originalPrice,
    required this.discountPercent,
    required this.affiliateUrl,
    required this.isOfficial,
    required this.inStock,
  });

  final String gameId;
  final String store;
  final double price;
  final double originalPrice;
  final int discountPercent;
  final String affiliateUrl;
  final bool isOfficial;
  final bool inStock;
}

String resolveOfferGameId(GameModel game) {
  final steam = game.steamAppID.trim();
  if (steam.isNotEmpty) return steam;
  final deal = game.dealID.trim();
  if (deal.isNotEmpty) return deal;
  return game.appId.trim().isEmpty ? 'unknown' : game.appId.trim();
}

int _discountForPrice(double price, double original) {
  if (original <= 0) return 0;
  final p = ((1 - price / original) * 100).round();
  return p.clamp(0, 100);
}

String _mockAffiliateUrl(String store, String gameId) {
  return 'https://steamdeal.app/affiliate?store=$store&game=${Uri.encodeComponent(gameId)}';
}

/// Mock：以当前 CheapShark/列表价为 Steam 参考价；第三方店按比例生成。
List<StoreOffer> buildMockStoreOffers(GameModel game) {
  final gameId = resolveOfferGameId(game);
  final steamIdForUrl = game.steamAppID.trim().isNotEmpty ? game.steamAppID.trim() : gameId;

  final steamOriginal = game.originalPrice > 0 ? game.originalPrice : game.price;
  var steamSale = game.price;
  if (steamSale <= 0 && steamOriginal > 0) {
    steamSale = steamOriginal * 0.5;
  }
  if (steamOriginal <= 0 && steamSale > 0) {
    // 无原价时用现价作展示原价，避免 UI 异常
    final synthetic = steamSale / 0.85;
    final steamOff = game.discount > 0 ? game.discount : _discountForPrice(steamSale, synthetic);
    return _fourStores(
      gameId: gameId,
      steamIdForUrl: steamIdForUrl,
      steamSale: steamSale,
      steamOriginal: synthetic,
      steamDiscount: steamOff,
      fanSale: steamSale * 0.7,
      gmgSale: steamSale * 0.8,
      cdkeysSale: steamSale * 0.6,
    );
  }

  final steamDiscount = game.discount > 0
      ? game.discount
      : _discountForPrice(steamSale, steamOriginal);

  return _fourStores(
    gameId: gameId,
    steamIdForUrl: steamIdForUrl,
    steamSale: steamSale,
    steamOriginal: steamOriginal,
    steamDiscount: steamDiscount,
    fanSale: steamSale * 0.7,
    gmgSale: steamSale * 0.8,
    cdkeysSale: steamSale * 0.6,
  );
}

List<StoreOffer> _fourStores({
  required String gameId,
  required String steamIdForUrl,
  required double steamSale,
  required double steamOriginal,
  required int steamDiscount,
  required double fanSale,
  required double gmgSale,
  required double cdkeysSale,
}) {
  final steamUrl = 'https://store.steampowered.com/app/$steamIdForUrl';

  return [
    StoreOffer(
      gameId: gameId,
      store: StoreIds.steam,
      price: steamSale,
      originalPrice: steamOriginal,
      discountPercent: steamDiscount,
      affiliateUrl: steamUrl,
      isOfficial: true,
      inStock: true,
    ),
    StoreOffer(
      gameId: gameId,
      store: StoreIds.fanatical,
      price: fanSale,
      originalPrice: steamOriginal,
      discountPercent: _discountForPrice(fanSale, steamOriginal),
      affiliateUrl: _mockAffiliateUrl(StoreIds.fanatical, gameId),
      isOfficial: false,
      inStock: true,
    ),
    StoreOffer(
      gameId: gameId,
      store: StoreIds.gmg,
      price: gmgSale,
      originalPrice: steamOriginal,
      discountPercent: _discountForPrice(gmgSale, steamOriginal),
      affiliateUrl: _mockAffiliateUrl(StoreIds.gmg, gameId),
      isOfficial: false,
      inStock: true,
    ),
    StoreOffer(
      gameId: gameId,
      store: StoreIds.cdkeys,
      price: cdkeysSale,
      originalPrice: steamOriginal,
      discountPercent: _discountForPrice(cdkeysSale, steamOriginal),
      affiliateUrl: _mockAffiliateUrl(StoreIds.cdkeys, gameId),
      isOfficial: false,
      inStock: true,
    ),
  ];
}

/// 是否具备至少一条可用于联盟跳转的报价（Mock 下恒为 true）。
bool hasAffiliateableOffer(GameModel game) {
  final list = buildMockStoreOffers(game);
  return list.any((o) => o.affiliateUrl.isNotEmpty && o.price > 0);
}
