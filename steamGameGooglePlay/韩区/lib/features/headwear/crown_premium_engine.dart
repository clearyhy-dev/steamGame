import 'dart:math' show atan2, min, max, pi, sqrt;

import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:image/image.dart' as img;

/// 皇冠引擎 v3：单一锚点、眼距缩放、眼睛连线旋转。
/// 锚点 = 人脸框顶 + 脸高比例（发际线附近），头饰底边落在此处，不浮空。
class CrownPremiumEngine {
  CrownPremiumEngine._();

  /// 单一锚点：anchorY = 头饰「底边」应落在的 Y（脸顶往下 18%～22% 脸高 ≈ 发际线）。
  /// dstY = anchorY - 头饰高 * (1 - sink)，sink 小量让底边略压进头发。
  static void applyPremiumCrown({
    required img.Image baseImage,
    required img.Image crownImage,
    required Face face,
    /// 头饰宽 = eyeDistance * widthFactor * scaleMultiplier
    double scaleMultiplier = 1.35,
    double widthFactor = 2.55,
    /// 锚点相对脸高：faceTop + faceHeight * anchorRatio（0.18～0.24 发际线附近）
    double anchorRatio = 0.20,
    /// 底边相对锚点“沉入”比例；素材底部 20% 留白时用 contentHeightRatio 即可，sink 可 0
    double sink = 0.0,
    /// 头饰「视觉底边」在图片高度中的比例（0.8 = 底部 20% 留白）
    double contentHeightRatio = 0.80,
    double perspectiveScale = 0.96,
    /// 头倾斜时跟随：以 headEulerAngleZ 为主，头歪则头饰跟着歪
    double rotateBlendEye = 0.18,
    double rotateBlendEulerZ = 0.82,
    int shadowOffsetX = 4,
    int shadowOffsetY = 6,
    double shadowAlpha = 0.4,
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
    final rotEye = atan2(dy, dx);
    final rotZ = ((face.headEulerAngleZ ?? 0.0) * pi / 180.0);
    final rot = rotEye * rotateBlendEye + rotZ * rotateBlendEulerZ;
    final angleDeg = rot * 180 / pi;

    final pitch = face.headEulerAngleX ?? 0.0;
    final yaw = face.headEulerAngleY ?? 0.0;
    final pitchAdj = -pitch * faceHeight * 0.004;
    final yawAdj = (-yaw) * eyeDist * 0.005;

    // 1) 缩放：眼距
    final maxW = baseImage.width;
    final w = (eyeDist * widthFactor * scaleMultiplier).round().clamp(24, maxW);
    img.Image resized = img.copyResize(crownImage, width: w);
    final ph = (resized.height * perspectiveScale).round().clamp(1, resized.height);
    resized = img.copyResize(resized, width: resized.width, height: ph);

    // 2) 旋转
    img.Image rotated = img.copyRotate(resized, angle: angleDeg);
    _makeBlackPixelsTransparent(rotated);

    // 3) 锚点：头饰视觉底边（contentHeightRatio 处）落在此 Y（发际线附近）
    final anchorY = faceTop + faceHeight * anchorRatio + pitchAdj;
    final contentH = rotated.height * contentHeightRatio;
    var dstY = (anchorY - contentH + rotated.height * sink).round();
    var dstX = (centerX + yawAdj - rotated.width / 2).round();

    // 4) 安全夹紧：不压眼，允许头饰再往下一点贴头顶
    final minY = (faceTop - rotated.height * 0.99).round();
    final bottomLimit = (eyeY - faceHeight * 0.08).round();
    final maxY = (bottomLimit - rotated.height * 0.52).round();
    dstY = dstY.clamp(min(minY, maxY), max(minY, maxY));
    dstY = dstY.clamp(0, baseImage.height - 1);
    dstX = dstX.clamp(-rotated.width ~/ 2, baseImage.width - 1);

    // 5) 阴影
    img.Image shadow = img.copyResize(crownImage, width: w);
    shadow = img.copyResize(shadow, width: shadow.width, height: ph);
    shadow = img.copyRotate(shadow, angle: angleDeg);
    _makeBlackPixelsTransparent(shadow);
    shadow = img.adjustColor(shadow, brightness: 0.2, saturation: 0.0, contrast: 0.9);
    _scaleAlpha(shadow, shadowAlpha);
    final shX = (dstX + shadowOffsetX).clamp(0, baseImage.width - 1);
    final shY = (dstY + shadowOffsetY).clamp(0, baseImage.height - 1);
    img.compositeImage(baseImage, shadow, dstX: shX, dstY: shY, dstW: shadow.width, dstH: shadow.height,
        srcX: 0, srcY: 0, srcW: shadow.width, srcH: shadow.height, blend: img.BlendMode.alpha);

    // 6) 皇冠
    final cx = dstX.clamp(0, baseImage.width - 1);
    final cy = dstY.clamp(0, baseImage.height - 1);
    img.compositeImage(baseImage, rotated, dstX: cx, dstY: cy, dstW: rotated.width, dstH: rotated.height,
        srcX: 0, srcY: 0, srcW: rotated.width, srcH: rotated.height, blend: img.BlendMode.alpha);
  }

  static void _makeBlackPixelsTransparent(img.Image image) {
    for (final p in image) {
      if (p.r.toInt() == 0 && p.g.toInt() == 0 && p.b.toInt() == 0) p.a = 0;
    }
  }

  static void _scaleAlpha(img.Image image, double factor) {
    for (final p in image) {
      p.a = (p.a.toInt() * factor).round().clamp(0, 255);
    }
  }
}
