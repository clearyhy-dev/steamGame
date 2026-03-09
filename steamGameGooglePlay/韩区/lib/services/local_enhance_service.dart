import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:image/image.dart' as img;

/// 本地快速增强（预览用）：仅做轻微锐化，避免对背景做明显调色导致「人像模式也改背景」的误解。
/// 使用 image 包，无网络，适合先快速出预览再上传服务端增强。
class LocalEnhanceService {
  /// 锐化强度 0~1，轻微即可
  static const double sharpenAmount = 0.32;

  /// 3x3 锐化核（中心加强、周围减弱）
  static const List<num> _sharpenKernel = [
    0, -1, 0,
    -1, 5, -1,
    0, -1, 0,
  ];

  /// 对解码后的图片做本地快速增强（调色 + 锐化），返回新 Image，不修改原图。
  static img.Image quickEnhanceImage(img.Image src) {
    img.Image out = img.Image.from(src);
    // 仅做轻微锐化（尽量不改变背景色调）
    out = img.convolution(
      out,
      filter: _sharpenKernel,
      div: 1.0,
      amount: sharpenAmount,
    );
    return out;
  }

  /// 从文件读取 → 本地快速增强 → 输出 JPEG 字节（用于上传或保存）。
  static Future<List<int>> quickEnhanceFileToJpeg(
    File file, {
    int maxWidth = 1600,
    int jpegQuality = 92,
    int maxPixels = 2000000,
  }) async {
    final bytes = await file.readAsBytes();
    final decoded = img.decodeImage(bytes);
    if (decoded == null) return bytes;
    final baked = img.bakeOrientation(decoded);
    final w = baked.width;
    final h = baked.height;
    final pixels = w * h;
    double scale = 1.0;
    if (w > maxWidth) {
      scale = math.min(scale, maxWidth / w);
    }
    if (pixels > maxPixels) {
      scale = math.min(scale, math.sqrt(maxPixels / pixels));
    }
    final int newW = scale < 0.999 ? math.max(1, (w * scale).round()) : w;
    final int newH = scale < 0.999 ? math.max(1, (h * scale).round()) : h;
    img.Image resized = (newW != w || newH != h)
        ? img.copyResize(
            baked,
            width: newW,
            height: newH,
            interpolation: img.Interpolation.average,
          )
        : baked;
    img.Image enhanced = quickEnhanceImage(resized);
    return img.encodeJpg(enhanced, quality: jpegQuality);
  }

  /// 从文件读取 → 本地快速增强 → 输出 base64 JPEG 字符串（用于调用 /enhance）。
  static Future<String> quickEnhanceFileToBase64(
    File file, {
    int maxWidth = 1600,
    int jpegQuality = 92,
    int maxPixels = 2000000,
  }) async {
    final jpegBytes = await quickEnhanceFileToJpeg(
      file,
      maxWidth: maxWidth,
      jpegQuality: jpegQuality,
      maxPixels: maxPixels,
    );
    return base64Encode(jpegBytes);
  }
}
