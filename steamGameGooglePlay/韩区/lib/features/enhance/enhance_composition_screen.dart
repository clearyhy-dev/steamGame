import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:google_mlkit_face_detection/google_mlkit_face_detection.dart';
import 'package:image/image.dart' as img;
import 'package:path_provider/path_provider.dart';

import '../../core/theme/app_theme.dart';
import '../../providers/app_providers.dart';

/// 只改构图：根据人脸位置做推荐裁剪并保存为新文件，替换当前会话中的这张照片。
class EnhanceCompositionScreen extends ConsumerStatefulWidget {
  const EnhanceCompositionScreen({super.key, required this.photoIndex});

  final int photoIndex;

  @override
  ConsumerState<EnhanceCompositionScreen> createState() =>
      _EnhanceCompositionScreenState();
}

class _EnhanceCompositionScreenState
    extends ConsumerState<EnhanceCompositionScreen> {
  bool _loading = false;
  String? _error;
  File? _previewFile;

  @override
  void initState() {
    super.initState();
    final photos = ref.read(photoProvider);
    if (widget.photoIndex >= 0 && widget.photoIndex < photos.length) {
      _previewFile = photos[widget.photoIndex].file;
    }
  }

  Future<void> _applyRecommendedCrop({required double aspectWOverH}) async {
    final photos = ref.read(photoProvider);
    if (widget.photoIndex < 0 || widget.photoIndex >= photos.length) return;
    final file = photos[widget.photoIndex].file;
    if (!await file.exists()) return;

    setState(() {
      _loading = true;
      _error = null;
    });

    FaceDetector? detector;
    try {
      final bytes = await file.readAsBytes();
      final decoded = img.decodeImage(bytes);
      if (decoded == null) {
        setState(() => _error = '图片解码失败');
        return;
      }

      // 人脸检测（用于推荐构图中心点）
      detector = FaceDetector(
        options: FaceDetectorOptions(
          performanceMode: FaceDetectorMode.fast,
          enableLandmarks: false,
          enableContours: false,
          enableTracking: false,
        ),
      );
      final input = InputImage.fromFilePath(file.path);
      final faces = await detector.processImage(input);

      Rect? faceRect;
      if (faces.isNotEmpty) {
        // 取最大脸作为主脸
        faces.sort((a, b) =>
            (b.boundingBox.width * b.boundingBox.height)
                .compareTo(a.boundingBox.width * a.boundingBox.height));
        faceRect = faces.first.boundingBox;
      }

      final w = decoded.width.toDouble();
      final h = decoded.height.toDouble();

      // 目标裁剪尺寸：尽量覆盖人像上半身（基于脸大小），无脸则居中裁剪
      final double targetAspect = aspectWOverH; // width/height
      double cropW;
      double cropH;
      double cx;
      double cy;
      if (faceRect != null) {
        cx = faceRect.center.dx;
        cy = faceRect.center.dy - faceRect.height * 0.15; // 略上移，留更多身体
        cropW = (faceRect.width * 2.8).clamp(480.0, w);
        cropH = cropW / targetAspect;
        if (cropH > h) {
          cropH = h;
          cropW = cropH * targetAspect;
        }
      } else {
        cx = w / 2;
        cy = h / 2;
        cropW = w;
        cropH = cropW / targetAspect;
        if (cropH > h) {
          cropH = h;
          cropW = cropH * targetAspect;
        }
      }

      double left = (cx - cropW / 2).clamp(0.0, (w - cropW).clamp(0.0, w));
      double top = (cy - cropH / 2).clamp(0.0, (h - cropH).clamp(0.0, h));

      final cropped = img.copyCrop(
        decoded,
        x: left.round(),
        y: top.round(),
        width: cropW.round(),
        height: cropH.round(),
      );

      final outJpg = img.encodeJpg(cropped, quality: 95);
      final dir = await getTemporaryDirectory();
      final outPath =
          '${dir.path}/composition_${DateTime.now().millisecondsSinceEpoch}.jpg';
      final outFile = File(outPath);
      await outFile.writeAsBytes(outJpg);

      ref.read(photoProvider.notifier).replaceAt(widget.photoIndex, outFile);
      setState(() => _previewFile = outFile);

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('已按推荐构图裁剪。建议重新评分后再美化。'),
            duration: const Duration(seconds: 3),
          ),
        );
      }
    } catch (e) {
      setState(() => _error =
          e.toString().replaceFirst(RegExp(r'^.*?Exception:?\s*'), ''));
    } finally {
      try {
        await detector?.close();
      } catch (_) {}
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: appSurfaceDark,
      appBar: AppBar(
        title: Text(
          '构图优化',
          style: GoogleFonts.merriweather(fontWeight: FontWeight.w600),
        ),
        centerTitle: true,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          Text(
            '根据人脸位置做推荐裁剪，只改变构图，不修改背景与光线。',
            style: GoogleFonts.inter(color: appLightGray, fontSize: 12),
          ),
          const SizedBox(height: 12),
          ClipRRect(
            borderRadius: BorderRadius.circular(14),
            child: _previewFile == null
                ? Container(
                    height: 260,
                    color: Colors.white12,
                    child: Icon(Icons.photo, color: appLightGray, size: 48),
                  )
                : Image.file(
                    _previewFile!,
                    height: 260,
                    width: double.infinity,
                    fit: BoxFit.cover,
                  ),
          ),
          const SizedBox(height: 14),
          if (_error != null)
            Text(
              _error!,
              style: GoogleFonts.inter(color: Colors.red.shade200, fontSize: 12),
            ),
          const SizedBox(height: 10),
          FilledButton.icon(
            onPressed: _loading ? null : () => _applyRecommendedCrop(aspectWOverH: 3 / 4),
            icon: _loading
                ? const SizedBox(
                    width: 18,
                    height: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.crop),
            label: const Text('推荐构图（3:4）'),
          ),
          const SizedBox(height: 10),
          OutlinedButton.icon(
            onPressed: _loading ? null : () => _applyRecommendedCrop(aspectWOverH: 1),
            icon: const Icon(Icons.crop_square),
            label: const Text('方形构图（1:1）'),
          ),
        ],
      ),
    );
  }
}

