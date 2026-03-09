import 'dart:io';
import 'dart:typed_data';
import 'dart:math' as math;

import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:image/image.dart' as img;
import 'package:path_provider/path_provider.dart';

import 'crown_premium_engine.dart';
import 'headpiece_engine.dart';

/// 本地头饰合成：ToC 通用（正头/侧头/任意照片尺寸）。
/// EXIF 方向自动纠正 + ML Kit 人脸检测 + [HeadpieceEngine] / [CrownPremiumEngine]。
class HatProcessor {
  static void _hardThresholdAlpha(img.Image src, {int alphaFloor = 20}) {
    for (final p in src) {
      if (p.a.toInt() <= alphaFloor) {
        p.a = 0;
      }
    }
  }

  static img.Image _cropToAlphaContent(
    img.Image src, {
    int pad = 2,
    int alphaThreshold = 28,
    double rowCoverageThreshold = 0.012,
  }) {
    int minX = src.width, minY = src.height, maxX = -1, maxY = -1;
    for (int y = 0; y < src.height; y++) {
      for (int x = 0; x < src.width; x++) {
        final p = src.getPixel(x, y);
        if (p.a.toInt() > alphaThreshold) {
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < 0 || maxY < 0) return src;
    minX = math.max(0, minX - pad);
    minY = math.max(0, minY - pad);
    maxX = math.min(src.width - 1, maxX + pad);
    maxY = math.min(src.height - 1, maxY + pad);
    final w = math.max(1, maxX - minX + 1);
    final h = math.max(1, maxY - minY + 1);
    img.Image cropped = img.copyCrop(src, x: minX, y: minY, width: w, height: h);

    // 再收紧上下透明边距：按“每行有效像素覆盖率”裁掉空白行，解决上下透明边距过大
    final minCount = math.max(1, (cropped.width * rowCoverageThreshold).round());

    int top = 0;
    for (int y = 0; y < cropped.height; y++) {
      int cnt = 0;
      for (int x = 0; x < cropped.width; x++) {
        if (cropped.getPixel(x, y).a.toInt() > alphaThreshold) cnt++;
      }
      if (cnt >= minCount) {
        top = y;
        break;
      }
    }

    int bottom = cropped.height - 1;
    for (int y = cropped.height - 1; y >= 0; y--) {
      int cnt = 0;
      for (int x = 0; x < cropped.width; x++) {
        if (cropped.getPixel(x, y).a.toInt() > alphaThreshold) cnt++;
      }
      if (cnt >= minCount) {
        bottom = y;
        break;
      }
    }

    top = math.max(0, top - pad);
    bottom = math.min(cropped.height - 1, bottom + pad);
    final newH = math.max(1, bottom - top + 1);
    if (newH < cropped.height) {
      cropped = img.copyCrop(cropped, x: 0, y: top, width: cropped.width, height: newH);
    }

    return cropped;
  }

  /// 头饰尺寸规范化：过大会导致缩放不一致、落点带偏。限制在 [maxWidth]×[maxHeight] 内，等比例缩放。
  static img.Image _normalizeHeadwearSize(
    img.Image src, {
    int maxWidth = 1024,
    int maxHeight = 1024,
    int minSize = 32,
  }) {
    int w = src.width;
    int h = src.height;
    if (w < minSize && h < minSize) return src;
    if (w <= maxWidth && h <= maxHeight) return src;
    final scale = math.min(maxWidth / w, maxHeight / h).clamp(0.0, 1.0);
    if (scale >= 1.0) return src;
    final nw = math.max(minSize, (w * scale).round());
    final nh = math.max(minSize, (h * scale).round());
    return img.copyResize(src, width: nw, height: nh);
  }

  /// [imageFile] 用户照片（任意分辨率、横竖屏均可），[hatBytes] 头饰 PNG。
  /// [usePremiumCrown] true 时皇冠走 Premium（混合锚点+阴影），否则走通用引擎。
  /// 返回合成后的临时文件，无人脸时返回 null。
  static Future<File?> addHat({
    required File imageFile,
    required List<int> hatBytes,
    bool usePremiumCrown = false,
    /// 头饰相对头的大小，按类型在 _hatConfig 里区分
    double scaleMultiplier = 1.25,
    /// 锚点相对脸高比例（越小越靠上），按类型配置
    double anchorRatio = 0.24,
    /// 下沉量（越大越贴头发）
    double sink = 0.04,
  }) async {
    final faceDetector = FaceDetector(
      options: FaceDetectorOptions(
        // 改为 fast 模式，显著降低头饰处理耗时。
        performanceMode: FaceDetectorMode.fast,
        enableLandmarks: true,
        // 现在锚点/旋转都不依赖 contours，关掉能更快更稳
        enableContours: false,
      ),
    );

    try {
      final imageBytes = await imageFile.readAsBytes();
      img.Image? baseImage = img.decodeImage(imageBytes);
      if (baseImage == null) return null;
      baseImage = img.bakeOrientation(baseImage);

      final directory = await getTemporaryDirectory();
      final bakedPath = '${directory.path}/hat_baked_${DateTime.now().millisecondsSinceEpoch}.jpg';
      final bakedFile = File(bakedPath);
      await bakedFile.writeAsBytes(img.encodeJpg(baseImage, quality: 95));
      final inputImageBaked = InputImage.fromFile(bakedFile);
      final faces = await faceDetector.processImage(inputImageBaked);
      try { bakedFile.deleteSync(); } catch (_) {}

      if (faces.isEmpty) return null;

      // 选最大脸，避免远处小脸导致头饰定位跑偏
      faces.sort((a, b) =>
          (b.boundingBox.width * b.boundingBox.height)
              .compareTo(a.boundingBox.width * a.boundingBox.height));
      final face = faces.first;
      if (face.boundingBox.width < 90) return null;

      img.Image? hatImage = img.decodePng(Uint8List.fromList(hatBytes));
      hatImage ??= img.decodeImage(Uint8List.fromList(hatBytes));
      if (hatImage == null) return null;
      // 1) 清掉低透明度毛边
      _hardThresholdAlpha(hatImage, alphaFloor: 18);
      // 2) 不裁切：素材已为 1024 宽、居中、底部 20% 留白，仅对超 1024 的图做等比例缩小
      hatImage = _normalizeHeadwearSize(hatImage, maxWidth: 1024, maxHeight: 1024);

      // 3) 底部 20% 留白：视觉底边在图片高度的 80% 处，锚点对齐该处
      const double contentHeightRatio = 0.80;

      // 按类型使用 _hatConfig 传入的 anchorRatio、sink、scaleMultiplier
      if (usePremiumCrown) {
        CrownPremiumEngine.applyPremiumCrown(
          baseImage: baseImage,
          crownImage: hatImage,
          face: face,
          scaleMultiplier: scaleMultiplier,
          anchorRatio: anchorRatio,
          sink: sink,
          contentHeightRatio: contentHeightRatio,
        );
      } else {
        HeadpieceEngine.applyHeadpiece(
          baseImage: baseImage,
          hatImage: hatImage,
          face: face,
          scaleMultiplier: scaleMultiplier,
          anchorRatio: anchorRatio,
          sink: sink,
          contentHeightRatio: contentHeightRatio,
        );
      }

      final outputPath =
          '${directory.path}/hat_${DateTime.now().millisecondsSinceEpoch}.jpg';
      final resultFile = File(outputPath);
      await resultFile.writeAsBytes(img.encodeJpg(baseImage, quality: 92));
      return resultFile;
    } finally {
      faceDetector.close();
    }
  }
}
