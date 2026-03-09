import 'dart:math' show atan2, min, max, pi, sqrt;

import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:image/image.dart' as img;

/// 通用头饰引擎 v2：与皇冠同一套「单一锚点」逻辑，底边落在 faceTop + 脸高比例。
class HeadpieceEngine {
  HeadpieceEngine._();

  static void applyHeadpiece({
    required img.Image baseImage,
    required img.Image hatImage,
    required Face face,
    double scaleMultiplier = 1.22,
    double widthFactor = 2.65,
    /// 锚点 = faceTop + faceHeight * anchorRatio（0.16～0.22）
    double anchorRatio = 0.19,
    double sink = 0.0,
    /// 头饰「视觉底边」在图片高度中的比例（0.8 = 底部 20% 留白）
    double contentHeightRatio = 0.80,
    /// 头倾斜时跟随：以 headEulerAngleZ 为主
    double rotateBlendEye = 0.18,
    double rotateBlendEulerZ = 0.82,
  }) {
    final leftEye = face.landmarks[FaceLandmarkType.leftEye];
    final rightEye = face.landmarks[FaceLandmarkType.rightEye];
    if (leftEye == null || rightEye == null) return;

    final faceHeight = face.boundingBox.height;
    final faceTop = face.boundingBox.top.toDouble();
    final eyeY = (leftEye.position.y + rightEye.position.y) / 2;
    final centerX = (leftEye.position.x + rightEye.position.x) / 2;

    final dx = rightEye.position.x - leftEye.position.x;
    final dy = rightEye.position.y - leftEye.position.y;
    final eyeDist = sqrt(dx * dx + dy * dy);
    final rot = atan2(dy, dx) * rotateBlendEye + ((face.headEulerAngleZ ?? 0.0) * pi / 180.0) * rotateBlendEulerZ;
    final angleDeg = rot * 180 / pi;

    final pitch = face.headEulerAngleX ?? 0.0;
    final yaw = face.headEulerAngleY ?? 0.0;
    final pitchAdj = -pitch * faceHeight * 0.004;
    final yawAdj = (-yaw) * eyeDist * 0.005;

    final w = (eyeDist * widthFactor * scaleMultiplier).round().clamp(24, baseImage.width);
    final h = (hatImage.height * w / hatImage.width).round();
    img.Image resized = img.copyResize(hatImage, width: w, height: h);
    resized = img.copyRotate(resized, angle: angleDeg);
    _makeBlackPixelsTransparent(resized);

    final anchorY = faceTop + faceHeight * anchorRatio + pitchAdj;
    final contentH = resized.height * contentHeightRatio;
    var dstY = (anchorY - contentH + resized.height * sink).round();
    var dstX = (centerX + yawAdj - resized.width / 2).round();

    final minY = (faceTop - resized.height * 0.99).round();
    final bottomLimit = (eyeY - faceHeight * 0.08).round();
    final maxY = (bottomLimit - resized.height * 0.52).round();
    dstY = dstY.clamp(min(minY, maxY), max(minY, maxY));
    dstY = dstY.clamp(0, baseImage.height - 1);
    dstX = dstX.clamp(-resized.width ~/ 2, baseImage.width - 1);

    final x = dstX.clamp(0, baseImage.width - 1);
    final y = dstY.clamp(0, baseImage.height - 1);
    img.compositeImage(baseImage, resized, dstX: x, dstY: y, dstW: resized.width, dstH: resized.height,
        srcX: 0, srcY: 0, srcW: resized.width, srcH: resized.height, blend: img.BlendMode.alpha);
  }

  static void _makeBlackPixelsTransparent(img.Image image) {
    for (final p in image) {
      if (p.r.toInt() == 0 && p.g.toInt() == 0 && p.b.toInt() == 0) p.a = 0;
    }
  }
}
