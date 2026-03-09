import 'photo_model.dart';

/// Attraction Intelligence Score™：多维度专业评分
class AttractionIntelligenceScore {
  final int overallAttractiveness;
  final int warmth;
  final int confidence;
  final int approachability;
  final int premiumMatchPotential;

  const AttractionIntelligenceScore({
    required this.overallAttractiveness,
    required this.warmth,
    required this.confidence,
    required this.approachability,
    required this.premiumMatchPotential,
  });

  factory AttractionIntelligenceScore.fromJson(Map<String, dynamic>? json) {
    if (json == null) {
      return const AttractionIntelligenceScore(
        overallAttractiveness: 0,
        warmth: 0,
        confidence: 0,
        approachability: 0,
        premiumMatchPotential: 0,
      );
    }
    return AttractionIntelligenceScore(
      overallAttractiveness: json['overallAttractiveness'] as int? ?? 0,
      warmth: json['warmth'] as int? ?? 0,
      confidence: json['confidence'] as int? ?? 0,
      approachability: json['approachability'] as int? ?? 0,
      premiumMatchPotential: json['premiumMatchPotential'] as int? ?? 0,
    );
  }
}

/// 单条 Bio：文案 + Why it works
class EliteBioItem {
  final String style; // Playful, Feminine, Confident, Mysterious, High-Value Woman
  final String text;
  final String whyItWorks;

  const EliteBioItem({
    required this.style,
    required this.text,
    required this.whyItWorks,
  });

  factory EliteBioItem.fromJson(Map<String, dynamic> json) {
    return EliteBioItem(
      style: json['style'] as String? ?? '',
      text: json['text'] as String? ?? '',
      whyItWorks: json['whyItWorks'] as String? ?? '',
    );
  }
}

/// Match Strategy Report：最佳顺序、品牌关键词、吸引类型、不建议风格
class MatchStrategyReport {
  final List<int> bestPhotoOrder;
  final List<String> personalBrandKeywords;
  final String attractiveToMaleTypes;
  final String stylesToAvoid;

  const MatchStrategyReport({
    this.bestPhotoOrder = const [],
    this.personalBrandKeywords = const [],
    this.attractiveToMaleTypes = '',
    this.stylesToAvoid = '',
  });

  factory MatchStrategyReport.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const MatchStrategyReport();
    final order = json['bestPhotoOrder'] as List<dynamic>?;
    final keywords = json['personalBrandKeywords'] as List<dynamic>?;
    return MatchStrategyReport(
      bestPhotoOrder:
          order?.map((e) => e is int ? e : int.tryParse(e.toString()) ?? 0).toList() ?? [],
      personalBrandKeywords:
          keywords?.map((e) => e.toString()).toList() ?? [],
      attractiveToMaleTypes:
          json['attractiveToMaleTypes'] as String? ?? '',
      stylesToAvoid: json['stylesToAvoid'] as String? ?? '',
    );
  }
}

class AnalysisResultModel {
  /// 兼容旧版：仅一个总分时映射到 attractionScore.overallAttractiveness
  final int confidenceScore;
  final List<RankedPhoto> rankedPhotos;
  /// 旧版 3 条 bio，新版用 eliteBios
  final BioSuggestions bioSuggestions;

  /// 高利润版：Attraction Intelligence Score™
  final AttractionIntelligenceScore attractionScore;
  /// 高利润版：5 种 Elite Bio（Playful, Feminine, Confident, Mysterious, High-Value Woman）
  final List<EliteBioItem> eliteBios;
  /// 高利润版：Match Strategy Report
  final MatchStrategyReport matchStrategy;
  /// 付费诱导：Pro 可提升的潜力描述
  final String upgradePotential;

  const AnalysisResultModel({
    required this.confidenceScore,
    required this.rankedPhotos,
    required this.bioSuggestions,
    this.attractionScore = const AttractionIntelligenceScore(
      overallAttractiveness: 0,
      warmth: 0,
      confidence: 0,
      approachability: 0,
      premiumMatchPotential: 0,
    ),
    this.eliteBios = const [],
    this.matchStrategy = const MatchStrategyReport(),
    this.upgradePotential = '',
  });

  factory AnalysisResultModel.fromJson(Map<String, dynamic> json) {
    final rankedList = json['rankedPhotos'] as List<dynamic>? ?? [];
    final conf = json['confidenceScore'] as int? ?? 0;
    final att = AttractionIntelligenceScore.fromJson(
      json['attractionScore'] as Map<String, dynamic>?,
    );
    final bios = json['eliteBios'] as List<dynamic>?;
    List<EliteBioItem> eliteList = [];
    if (bios != null) {
      eliteList = bios
          .map((e) => EliteBioItem.fromJson(e as Map<String, dynamic>))
          .toList();
    }
    return AnalysisResultModel(
      confidenceScore: conf,
      rankedPhotos: rankedList
          .map((e) => RankedPhoto.fromJson(e as Map<String, dynamic>))
          .toList(),
      bioSuggestions: BioSuggestions.fromJson(
        json['bioSuggestions'] as Map<String, dynamic>? ?? {},
      ),
      attractionScore: att.overallAttractiveness > 0
          ? att
          : AttractionIntelligenceScore(
              overallAttractiveness: conf,
              warmth: 0,
              confidence: conf,
              approachability: 0,
              premiumMatchPotential: 0,
            ),
      eliteBios: eliteList,
      matchStrategy: MatchStrategyReport.fromJson(
        json['matchStrategy'] as Map<String, dynamic>?,
      ),
      upgradePotential: json['upgradePotential'] as String? ?? '',
    );
  }
}

class BioSuggestions {
  final String playful;
  final String confident;
  final String elegant;

  const BioSuggestions({
    required this.playful,
    required this.confident,
    required this.elegant,
  });

  factory BioSuggestions.fromJson(Map<String, dynamic> json) {
    return BioSuggestions(
      playful: json['playful'] as String? ?? '',
      confident: json['confident'] as String? ?? '',
      elegant: json['elegant'] as String? ?? '',
    );
  }
}
