import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/services.dart';
import 'package:google_mlkit_selfie_segmentation/google_mlkit_selfie_segmentation.dart';
import 'package:image/image.dart' as img;
import 'package:path_provider/path_provider.dart';

/// 方案 1：Google ML Kit 自拍分割 + 本地合成。
/// 流程：先人体提取（显示提取的人体，更自然）→ 用户选择背景 → 合成。
/// 质量关键：mask 边缘羽化、前景轻微提亮、背景轻微虚化。
class BackgroundReplacementService {
  BackgroundReplacementService._();

  /// 提取人像：不羽化、不锐化，只做双线性 mask，贴近手机那种干净利落
  static const int _featherRadiusExtract = 3;
  /// 一步合成时的羽化（可略大）
  static const int _featherRadiusReplace = 4;
  /// 前景提亮：尽量不改变原色，避免不自然
  static const double _foregroundBrightness = 1.00;
  /// 背景虚化：合成时背景轻微虚化
  static const int _bgBlurRadius = 2;

  /// Alpha 细节：让边缘更像手机效果（更干净、少白边）
  static const double _alphaGamma = 0.85; // <1 更实
  static const int _alphaErode = 1; // 0/1 推荐
  static const int _alphaFeather = 2; // 0~3
  static const int _alphaCut = 10; // 0~255，小于则置0

  /// 按最长边缩放到 [maxSide]，用于预览/导出控制速度
  static img.Image _resizeToMaxSide(img.Image src, int maxSide) {
    final w = src.width, h = src.height;
    final m = w > h ? w : h;
    if (m <= maxSide) return src;
    final s = maxSide / m;
    return img.copyResize(src, width: (w * s).round(), height: (h * s).round());
  }

  /// 第一步：人体提取。目标效果接近手机自带——边缘清晰、无糊无晕、人物干净。
  /// [maxSide] 先缩图再抠，预览用 1024 可做到 1 秒级。
  static Future<File?> extractPerson(File photoFile, {int maxSide = 1024}) async {
    final segmenter = SelfieSegmenter(
      mode: SegmenterMode.single,
      enableRawSizeMask: false,
    );
    try {
      final photoBytes = await photoFile.readAsBytes();
      img.Image? photoImage = img.decodeImage(photoBytes);
      if (photoImage == null) return null;
      photoImage = img.bakeOrientation(photoImage);
      photoImage = _resizeToMaxSide(photoImage, maxSide);
      final w = photoImage.width;
      final h = photoImage.height;

      final dir = await getTemporaryDirectory();
      final tempPhoto = File('${dir.path}/bg_extract_photo_${DateTime.now().millisecondsSinceEpoch}.jpg');
      await tempPhoto.writeAsBytes(img.encodeJpg(photoImage, quality: 85));
      final inputImage = InputImage.fromFilePath(tempPhoto.path);
      final mask = await segmenter.processImage(inputImage);
      try { tempPhoto.deleteSync(); } catch (_) {}
      if (mask == null || mask.confidences.isEmpty) return null;

      final mw = mask.width;
      final mh = mask.height;
      final confidences = mask.confidences;

      final maskSmall = img.Image(width: mw, height: mh);
      for (int y = 0; y < mh; y++) {
        for (int x = 0; x < mw; x++) {
          final c = confidences[y * mw + x].clamp(0.0, 1.0);
          final v = (c * 255).round().clamp(0, 255);
          maskSmall.setPixelRgba(x, y, v, v, v, 255);
        }
      }

      img.Image maskImage = img.copyResize(
        maskSmall,
        width: w,
        height: h,
        interpolation: img.Interpolation.linear,
      );
      if (_featherRadiusExtract > 0) {
        maskImage = _featherMask(maskImage, radius: _featherRadiusExtract);
      }

      photoImage = _brighten(photoImage, factor: _foregroundBrightness);

      // 输出 RGBA：人像原样 + 顺滑 alpha，背景透明
      final rgba = img.Image(width: w, height: h, numChannels: 4);
      for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
          final p = photoImage.getPixel(x, y);
          final a = maskImage.getPixel(x, y).r.toInt();
          rgba.setPixelRgba(x, y, p.r.toInt(), p.g.toInt(), p.b.toInt(), a);
        }
      }

      final outPath = '${dir.path}/extracted_person_${DateTime.now().millisecondsSinceEpoch}.png';
      final outFile = File(outPath);
      await outFile.writeAsBytes(img.encodePng(rgba));
      return outFile;
    } finally {
      segmenter.close();
    }
  }

  /// 第二步：将已提取的人像（PNG 带透明）与选定背景合成。
  /// [extractedPersonPng] 由 [extractPerson] 得到，[backgroundAssetPath] 如 'assets/backgrounds/xx.jpg'。
  static Future<File?> compositeWithBackground({
    required File extractedPersonPng,
    required String backgroundAssetPath,
  }) async {
    final fgBytes = await extractedPersonPng.readAsBytes();
    img.Image? fg = img.decodeImage(fgBytes);
    if (fg == null) return null;
    final w = fg.width;
    final h = fg.height;

    final bgBytes = await rootBundle.load(backgroundAssetPath);
    img.Image? bg = img.decodeImage(bgBytes.buffer.asUint8List());
    if (bg == null) return null;
    bg = img.copyResize(bg, width: w, height: h);
    bg = _boxBlur(bg, radius: _bgBlurRadius);

    img.compositeImage(bg, fg, blend: img.BlendMode.alpha);

    final dir = await getTemporaryDirectory();
    final outFile = File('${dir.path}/bg_composite_${DateTime.now().millisecondsSinceEpoch}.jpg');
    await outFile.writeAsBytes(img.encodeJpg(bg, quality: 92));
    return outFile;
  }

  /// 带变换的合成：把 UI 上的 scale/offset 映射到输出图，导出一致。
  static Future<File?> compositeWithTransform({
    required File extractedPersonPng,
    required String backgroundAssetPath,
    required double userScale,
    required double offsetX,
    required double offsetY,
    required double baseFitScale,
    required int canvasW,
    required int canvasH,
    int maxSide = 1024,
  }) async {
    final fgBytes = await extractedPersonPng.readAsBytes();
    img.Image? fg = img.decodeImage(fgBytes);
    if (fg == null) return null;

    final bgBytes = await rootBundle.load(backgroundAssetPath);
    img.Image? bg = img.decodeImage(bgBytes.buffer.asUint8List());
    if (bg == null) return null;

    bg = img.bakeOrientation(bg);
    bg = _resizeToMaxSide(bg, maxSide);
    final outW = bg.width;
    final outH = bg.height;

    final sx = outW / canvasW;
    final sy = outH / canvasH;
    final finalScale = baseFitScale * userScale;
    final fgW = (fg.width * finalScale * sx).round();
    final fgH = (fg.height * finalScale * sy).round();
    if (fgW <= 1 || fgH <= 1) return null;

    final fgScaled = img.copyResize(
      fg,
      width: fgW,
      height: fgH,
      interpolation: img.Interpolation.linear,
    );

    final dx = (offsetX * sx).round();
    final dy = (offsetY * sy).round();

    bg = _boxBlur(bg, radius: _bgBlurRadius);
    img.compositeImage(
      bg,
      fgScaled,
      dstX: dx,
      dstY: dy,
      dstW: fgScaled.width,
      dstH: fgScaled.height,
      blend: img.BlendMode.alpha,
    );

    final dir = await getTemporaryDirectory();
    final outFile = File('${dir.path}/bg_transform_${DateTime.now().millisecondsSinceEpoch}.jpg');
    await outFile.writeAsBytes(img.encodeJpg(bg, quality: 92));
    return outFile;
  }

  /// 兼容旧流程：一步完成提取+合成（不单独展示提取的人体）。
  static Future<File?> replaceBackground({
    required File photoFile,
    required String backgroundAssetPath,
  }) async {
    final segmenter = SelfieSegmenter(
      mode: SegmenterMode.single,
      enableRawSizeMask: false,
    );
    try {
      final photoBytes = await photoFile.readAsBytes();
      img.Image? photoImage = img.decodeImage(photoBytes);
      if (photoImage == null) return null;
      photoImage = img.bakeOrientation(photoImage);
      final w = photoImage.width;
      final h = photoImage.height;

      // 写入临时文件供 ML Kit 使用（需要文件路径）
      final dir = await getTemporaryDirectory();
      final tempPhoto = File('${dir.path}/bg_replace_photo_${DateTime.now().millisecondsSinceEpoch}.jpg');
      await tempPhoto.writeAsBytes(img.encodeJpg(photoImage, quality: 92));
      final inputImage = InputImage.fromFilePath(tempPhoto.path);
      final mask = await segmenter.processImage(inputImage);
      try { tempPhoto.deleteSync(); } catch (_) {}
      if (mask == null || mask.confidences.isEmpty) return null;

      final mw = mask.width;
      final mh = mask.height;
      final confidences = mask.confidences;

      // 将 mask 缩放到照片尺寸，并转为灰度图（0~255）
      img.Image maskImage = img.Image(width: w, height: h);
      for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
          final mx = (x * mw / w).floor().clamp(0, mw - 1);
          final my = (y * mh / h).floor().clamp(0, mh - 1);
          final c = confidences[my * mw + mx].clamp(0.0, 1.0);
          final v = (c * 255).round().clamp(0, 255);
          maskImage.setPixelRgba(x, y, v, v, v, 255);
        }
      }

      // 羽化：对 mask 做 box blur，边缘变柔
      maskImage = _featherMask(maskImage, radius: _featherRadiusReplace);

      // 加载背景并缩放到照片尺寸
      final bgBytes = await rootBundle.load(backgroundAssetPath);
      final bgUint = bgBytes.buffer.asUint8List();
      img.Image? bgImage = img.decodeImage(bgUint);
      if (bgImage == null) return null;
      bgImage = img.copyResize(bgImage, width: w, height: h);
      bgImage = _boxBlur(bgImage, radius: _bgBlurRadius);

      // 前景轻微提亮
      photoImage = _brighten(photoImage, factor: _foregroundBrightness);

      // 合成：out = bg * (1 - alpha) + fg * alpha
      final outImage = img.Image(width: w, height: h);
      for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
          final maskP = maskImage.getPixel(x, y);
          final a = maskP.r.toInt() / 255.0;
          final fg = photoImage.getPixel(x, y);
          final bg = bgImage.getPixel(x, y);
          final r = (bg.r.toInt() * (1 - a) + fg.r.toInt() * a).round().clamp(0, 255);
          final g = (bg.g.toInt() * (1 - a) + fg.g.toInt() * a).round().clamp(0, 255);
          final b = (bg.b.toInt() * (1 - a) + fg.b.toInt() * a).round().clamp(0, 255);
          outImage.setPixelRgba(x, y, r, g, b, 255);
        }
      }

      final outPath = '${dir.path}/bg_result_${DateTime.now().millisecondsSinceEpoch}.jpg';
      final outFile = File(outPath);
      await outFile.writeAsBytes(img.encodeJpg(outImage, quality: 92));
      return outFile;
    } finally {
      se
  /// Alpha refinement: cut tiny alpha, optional erode to remove halo, gamma harden, then light feather.
  static img.Image _refineAlpha(img.Image mask) {
    final w = mask.width, h = mask.height;
    // 1) cut low alpha to 0 (remove speckles)
    for (int y = 0; y < h; y++) {
      for (int x = 0; x < w; x++) {
        final a = mask.getPixel(x, y).r.toInt();
        final v = (a < _alphaCut) ? 0 : a;
        if (v != a) mask.setPixelRgba(x, y, v, v, v, 255);
      }
    }
    // 2) erode one pixel to reduce white halo
    if (_alphaErode > 0) {
      mask = _erodeAlpha(mask, iterations: _alphaErode);
    }
    // 3) gamma harden
    if (_alphaGamma != 1.0) {
      for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
          final a = mask.getPixel(x, y).r.toInt() / 255.0;
          final g = math.pow(a, _alphaGamma).toDouble();
          final v = (g * 255.0).round().clamp(0, 255);
          mask.setPixelRgba(x, y, v, v, v, 255);
        }
      }
    }
    // 4) light feather for smooth edge
    if (_alphaFeather > 0) {
      mask = _featherMask(mask, radius: _alphaFeather);
    }
    return mask;
  }

  /// Simple alpha erosion using min filter (fast enough at maxSide=1024).
  static img.Image _erodeAlpha(img.Image src, {int iterations = 1}) {
    img.Image cur = src;
    for (int it = 0; it < iterations; it++) {
      final w = cur.width, h = cur.height;
      final out = img.Image(width: w, height: h);
      for (int y = 0; y < h; y++) {
        for (int x = 0; x < w; x++) {
          int minA = 255;
          for (int dy = -1; dy <= 1; dy++) {
            final yy = y + dy;
            if (yy < 0 || yy >= h) continue;
            for (int dx = -1; dx <= 1; dx++) {
              final xx = x + dx;
              if (xx < 0 || xx >= w) continue;
              final a = cur.getPixel(xx, yy).r.toInt();
              if (a < minA) minA = a;
            }
          }
          out.setPixelRgba(x, y, minA, minA, minA, 255);
        }
      }
      cur = out;
    }
    return cur;
  }

gmenter.close();
    }
  }

  /// 对 mask 做 box blur 实现羽化
  static img.Image _featherMask(img.Image mask, {int radius = 4}) {
    return _boxBlur(mask, radius: radius);
  }

  static img.Image _boxBlur(img.Image src, {int radius = 2}) {
    if (radius <= 0) return src;
    final r = radius.clamp(1, 8);
    int size = r * 2 + 1;
    final kernel = List.filled(size * size, 1.0 / (size * size));
    return img.convolution(src, filter: kernel, div: 1.0, amount: 1.0);
  }

  static img.Image _brighten(img.Image src, {double factor = 1.08}) {
    return img.adjustColor(src, brightness: factor);
  }
}
