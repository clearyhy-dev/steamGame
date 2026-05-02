import '../../../models/game_model.dart';

/// 与后端 `HomeRecommendationItem` 对齐。
class RecommendedItem {
  final String steamAppId;
  final String dealId;
  final String title;
  final String capsuleImage;
  final double currentPrice;
  final double originalPrice;
  final int discountPercent;
  final double score;
  final List<String> reasons;
  final List<String> tags;

  RecommendedItem({
    required this.steamAppId,
    required this.dealId,
    required this.title,
    required this.capsuleImage,
    required this.currentPrice,
    required this.originalPrice,
    required this.discountPercent,
    required this.score,
    required this.reasons,
    required this.tags,
  });

  factory RecommendedItem.fromJson(Map<String, dynamic> j) {
    final reasons = (j['reasons'] as List<dynamic>? ?? []).map((e) => e.toString()).toList();
    final tags = (j['tags'] as List<dynamic>? ?? []).map((e) => e.toString()).toList();
    return RecommendedItem(
      steamAppId: j['steamAppId']?.toString() ?? '',
      dealId: j['dealId']?.toString() ?? '',
      title: j['title']?.toString() ?? '',
      capsuleImage: j['capsuleImage']?.toString() ?? '',
      currentPrice: _d(j['currentPrice']),
      originalPrice: _d(j['originalPrice']),
      discountPercent: _i(j['discountPercent']),
      score: _d(j['score']),
      reasons: reasons,
      tags: tags.isNotEmpty ? tags : reasons,
    );
  }

  static double _d(dynamic v) {
    if (v == null) return 0;
    if (v is num) return v.toDouble();
    return double.tryParse(v.toString()) ?? 0;
  }

  static int _i(dynamic v) {
    if (v == null) return 0;
    if (v is int) return v;
    if (v is num) return v.round();
    return int.tryParse(v.toString()) ?? 0;
  }

  /// 详情页 / 愿望单逻辑复用 CheapShark [GameModel]。
  GameModel toGameModel() {
    return GameModel(
      dealID: dealId,
      appId: dealId.isNotEmpty ? dealId : steamAppId,
      name: title,
      image: capsuleImage,
      price: currentPrice,
      originalPrice: originalPrice,
      discount: discountPercent,
      steamAppID: steamAppId,
      images: capsuleImage.isNotEmpty ? [capsuleImage] : const [],
      priceIsGlobalUsd: true,
    );
  }
}

class HomeRecommendationsMeta {
  final bool steamLinked;
  final String? profileName;
  final String generatedAt;
  final bool cacheHit;

  HomeRecommendationsMeta({
    required this.steamLinked,
    this.profileName,
    required this.generatedAt,
    required this.cacheHit,
  });

  factory HomeRecommendationsMeta.fromJson(Map<String, dynamic> j) {
    return HomeRecommendationsMeta(
      steamLinked: j['steamLinked'] == true,
      profileName: j['profileName']?.toString(),
      generatedAt: j['generatedAt']?.toString() ?? '',
      cacheHit: j['cacheHit'] == true,
    );
  }
}
