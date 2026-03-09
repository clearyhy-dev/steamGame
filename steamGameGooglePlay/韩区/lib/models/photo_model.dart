import 'dart:io';

class PhotoModel {
  final File file;
  final String? base64;

  const PhotoModel({required this.file, this.base64});

  PhotoModel withBase64(String value) => PhotoModel(file: file, base64: value);
}

/// 单张照片的心理学拆解：第一印象、Swipe 概率、优化建议
class RankedPhoto {
  final int index;
  final int score;
  final String reason;
  /// 男性第一印象反应预测
  final String firstImpressionPrediction;
  /// Swipe 概率 如 78
  final int swipeProbability;
  /// 建议优化点
  final String improvementTip;
  /// Confidence Impact: High / Medium / Low
  final String confidenceImpact;

  const RankedPhoto({
    required this.index,
    required this.score,
    this.reason = '',
    this.firstImpressionPrediction = '',
    this.swipeProbability = 0,
    this.improvementTip = '',
    this.confidenceImpact = '',
  });

  factory RankedPhoto.fromJson(Map<String, dynamic> json) {
    return RankedPhoto(
      index: json['index'] as int? ?? 0,
      score: json['score'] as int? ?? 0,
      reason: json['reason'] as String? ?? '',
      firstImpressionPrediction:
          json['firstImpressionPrediction'] as String? ?? '',
      swipeProbability: json['swipeProbability'] as int? ?? 0,
      improvementTip: json['improvementTip'] as String? ?? '',
      confidenceImpact: json['confidenceImpact'] as String? ?? '',
    );
  }
}
