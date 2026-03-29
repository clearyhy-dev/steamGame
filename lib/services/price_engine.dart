import '../models/store_offer.dart';

class PriceResult {
  const PriceResult({this.bestOfficial, this.cheapest});

  final StoreOffer? bestOfficial;
  final StoreOffer? cheapest;
}

/// 最低价：官方渠道最优 vs 全渠道（含第三方 key 店）最优。
class PriceEngineService {
  PriceResult calculateBestPrice(List<StoreOffer> offers) {
    if (offers.isEmpty) {
      return const PriceResult();
    }
    final valid = offers.where((o) => o.price > 0 && o.inStock).toList();
    if (valid.isEmpty) {
      return const PriceResult();
    }

    StoreOffer? bestOfficial;
    for (final o in valid) {
      if (!o.isOfficial) continue;
      if (bestOfficial == null || o.price < bestOfficial.price) {
        bestOfficial = o;
      }
    }

    StoreOffer? cheapest;
    for (final o in valid) {
      if (cheapest == null || o.price < cheapest.price) cheapest = o;
    }

    return PriceResult(bestOfficial: bestOfficial, cheapest: cheapest);
  }
}
