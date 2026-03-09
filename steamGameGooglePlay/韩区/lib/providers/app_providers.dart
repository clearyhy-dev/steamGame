import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math' as math;

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image/image.dart' as img;
import 'package:path_provider/path_provider.dart';
import 'package:uuid/uuid.dart';

import 'package:firebase_auth/firebase_auth.dart';

import '../core/constants/app_constants.dart';
import '../core/locale/locale_service.dart';
import '../models/analysis_result_model.dart';
import '../models/photo_model.dart';
import '../services/api_service.dart';
import '../services/auth_service.dart';
import '../services/local_enhance_service.dart';
import '../services/purchase_service.dart';
import '../services/storage_service.dart';

final photoProvider = StateNotifierProvider<PhotoNotifier, List<PhotoModel>>(
  (ref) => PhotoNotifier(),
);

class PhotoNotifier extends StateNotifier<List<PhotoModel>> {
  PhotoNotifier() : super([]);

  void add(File file, {int? maxPhotos}) {
    final cap = maxPhotos ?? AppConstants.maxPhotos;
    if (state.length >= cap) return;
    state = [...state, PhotoModel(file: file)];
  }

  void removeAt(int index) {
    if (index < 0 || index >= state.length) return;
    state = state.asMap().entries.where((e) => e.key != index).map((e) => e.value).toList();
  }

  void replaceAt(int index, File file) {
    if (index < 0 || index >= state.length) return;
    final next = [...state];
    next[index] = PhotoModel(file: file);
    state = next;
  }

  void clear() => state = [];
}

/// 认证状态：优先 Firebase，未登录为 null。
final authStateProvider = StreamProvider<User?>((ref) => AuthService.authStateChanges);

/// 用户 ID：优先 Firebase uid，未登录时 fallback 到本地 UUID。
final uidProvider = FutureProvider<String>((ref) async {
  await ref.watch(authStateProvider.future);
  final user = ref.read(authStateProvider).valueOrNull;
  if (user?.uid != null && user!.uid.isNotEmpty) return user.uid;
  var id = StorageService.uid;
  if (id == null || id.isEmpty) {
    id = const Uuid().v4();
    await StorageService.setUid(id);
  }
  return id;
});

final apiServiceProvider = Provider<ApiService>((ref) => ApiService());

final purchaseServiceProvider = Provider<PurchaseService>((ref) {
  final service = PurchaseService();
  ref.onDispose(service.dispose);
  return service;
});

final purchasedProvider = StateProvider<bool>((ref) {
  return AppConstants.kUnlockProForTesting || StorageService.hasUnlockedFullReport;
});

/// 应用内选择的语言：null = 跟随系统，en/ja/ko/zh = 指定语言。变更后需刷新界面。
final languageOverrideProvider = StateProvider<String?>((ref) => StorageService.languageOverride);

final analysisResultProvider =
    StateProvider<AnalysisResultModel?>((ref) => null);

final analysisLoadingProvider = StateProvider<bool>((ref) => false);

final analysisErrorProvider = StateProvider<String?>((ref) => null);

final enhancedImageUrlProvider = StateProvider<String?>((ref) => null);

/// 人像美化风格：portrait | natural_glow | luxury_studio | soft_feminine |
/// flower_crown | princess_tiara | butterfly_aura | sparkle_light | pastel_anime（与 API prompt_style 一致）
final enhanceStyleProvider = StateProvider<String>((ref) => 'portrait');

/// 结果页「重新应用风格」时的 loading
final reEnhanceLoadingProvider = StateProvider<bool>((ref) => false);

/// 用于背景替换的照片（从结果页传入）
final backgroundReplacePhotoProvider = StateProvider<File?>((ref) => null);

/// 人体提取后的 PNG 文件（透明背景），选背景合成时使用
final extractedPersonFileProvider = StateProvider<File?>((ref) => null);

// =========================
// 模块化：图片美化（上传/分析/结果/历史）
// =========================
/// 当前一次分析会话 id（用于把多张图的分析记录归为一组）
final enhanceSessionIdProvider = StateProvider<String?>((ref) => null);

/// 图片美化：历史列表（按 uid）
final enhanceAnalysisHistoryProvider =
    FutureProvider<List<Map<String, dynamic>>>((ref) async {
  final uid = await ref.read(uidProvider.future);
  return StorageService.getAnalysisHistory(uid);
});

/// 图片美化：每张图的美化结果 URL（index -> url）
final enhanceUrlByIndexProvider =
    StateProvider<Map<int, String>>((ref) => <int, String>{});

/// 图片美化：对某张图执行美化时的 loading（index -> bool）
final enhanceLoadingByIndexProvider =
    StateProvider<Map<int, bool>>((ref) => <int, bool>{});

/// 图片美化：为某张图执行 /enhance
final enhancePhotoProvider =
    Provider<Future<void> Function({required int photoIndex, required String style})>(
        (ref) {
  return ({required int photoIndex, required String style}) async {
    final photos = ref.read(photoProvider);
    if (photoIndex < 0 || photoIndex >= photos.length) return;
    final file = photos[photoIndex].file;
    if (!await file.exists()) return;

    final loadingMap = {...ref.read(enhanceLoadingByIndexProvider)};
    loadingMap[photoIndex] = true;
    ref.read(enhanceLoadingByIndexProvider.notifier).state = loadingMap;

    try {
      final uid = await ref.read(uidProvider.future);
      final base64 = await compressAndEncode(
        file,
        maxWidth: 1280,
        quality: 86,
      );
      final api = ref.read(apiServiceProvider);
      final url = await api.enhance(
        uid: uid,
        bestPhotoBase64: base64,
        promptStyle: style,
      );
      ref.read(enhanceUrlByIndexProvider.notifier).state = {
        ...ref.read(enhanceUrlByIndexProvider),
        photoIndex: url,
      };

      // 同步写入分析历史（若能定位到本次会话记录）
      final sessionId = ref.read(enhanceSessionIdProvider);
      if (sessionId != null) {
        final entryId = '$sessionId:$photoIndex';
        await StorageService.setAnalysisHistoryEnhanceResult(
          uid: uid,
          entryId: entryId,
          enhancedUrl: url,
          style: style,
        );
        ref.invalidate(enhanceAnalysisHistoryProvider);
      }

      // 兼容旧 History：仍记录“美化结果 + 分数”
      final result = ref.read(analysisResultProvider);
      final ranked = result?.rankedPhotos
          .firstWhere((r) => r.index == photoIndex, orElse: () => const RankedPhoto(index: 0, score: 0));
      await StorageService.addHistory(
        enhancedUrl: url,
        score: ranked?.score ?? 0,
      );
    } finally {
      final m = {...ref.read(enhanceLoadingByIndexProvider)};
      m[photoIndex] = false;
      ref.read(enhanceLoadingByIndexProvider.notifier).state = m;
    }
  };
});

Future<String> compressAndEncode(File file, {int maxWidth = 1200, int quality = 85}) async {
  final bytes = await file.readAsBytes();
  return compressImageBytesToBase64(
    bytes,
    maxWidth: maxWidth,
    quality: quality,
  );
}

/// 将图片字节（网络下载或文件读入）压缩后转 base64，用于减小请求体避免 413。
Future<String> compressImageBytesToBase64(List<int> bytes,
    {int maxWidth = 800, int quality = 82, int maxPixels = 2000000}) async {
  final decoded = img.decodeImage(Uint8List.fromList(bytes));
  if (decoded == null) return base64Encode(bytes);
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

  final img.Image image;
  if (scale < 0.999) {
    final newW = math.max(1, (w * scale).round());
    final newH = math.max(1, (h * scale).round());
    image = img.copyResize(
      baked,
      width: newW,
      height: newH,
      interpolation: img.Interpolation.average,
    );
  } else {
    image = baked;
  }

  final encoded = img.encodeJpg(image, quality: quality);
  return base64Encode(encoded);
}

final analyzeProvider = Provider<Future<void> Function()>((ref) {
  return () async {
    final photos = ref.read(photoProvider);
    final purchased = ref.read(purchasedProvider);
    final minRequired = purchased ? AppConstants.minPhotos : AppConstants.minPhotosFree;
    if (photos.length < minRequired) return;

    ref.read(analysisLoadingProvider.notifier).state = true;
    ref.read(analysisErrorProvider.notifier).state = null;
    ref.read(enhancedImageUrlProvider.notifier).state = null;

    try {
      final uid = await ref.read(uidProvider.future);
      // 并行压缩与编码，减少「点击分析」等待时长。
      final base64List = await Future.wait(
        photos.map(
          (p) => compressAndEncode(
            p.file,
            maxWidth: 1024,
            quality: 80,
          ),
        ),
      );

      final api = ref.read(apiServiceProvider);
      final lang = LocaleService.getLanguageCode();
      final result = await api.analyze(
        uid: uid,
        photosBase64: base64List,
        lang: lang,
      );
      ref.read(analysisResultProvider.notifier).state = result;

      // 记录「图片美化」分析历史：每张图一条（按 uid）
      final sessionId = DateTime.now().millisecondsSinceEpoch.toString();
      ref.read(enhanceSessionIdProvider.notifier).state = sessionId;
      for (final r in result.rankedPhotos) {
        final idx = r.index;
        final path = (idx >= 0 && idx < photos.length) ? photos[idx].file.path : null;
        await StorageService.addAnalysisHistoryEntry(
          uid: uid,
          entry: {
            'id': '$sessionId:$idx',
            'sessionId': sessionId,
            'ts': DateTime.now().toIso8601String(),
            'photoIndex': idx,
            'photoPath': path,
            'score': r.score,
            'reason': r.reason,
            'firstImpressionPrediction': r.firstImpressionPrediction,
            'swipeProbability': r.swipeProbability,
            'improvementTip': r.improvementTip,
            'confidenceImpact': r.confidenceImpact,
          },
        );
      }
      ref.invalidate(enhanceAnalysisHistoryProvider);

      final bestIndex = result.rankedPhotos.isNotEmpty
          ? result.rankedPhotos.first.index
          : 0;
      if (bestIndex < photos.length) {
        final bestFile = photos[bestIndex].file;
        // Step A：本地秒出预览（0.2~0.6s），Result 页立刻有 After
        final previewJpegBytes = await LocalEnhanceService.quickEnhanceFileToJpeg(
          bestFile,
          maxWidth: 1600,
          jpegQuality: 92,
        );
        final dir = await getTemporaryDirectory();
        final previewPath = '${dir.path}/after_preview_${DateTime.now().millisecondsSinceEpoch}.jpg';
        final previewFile = File(previewPath);
        await previewFile.writeAsBytes(previewJpegBytes);
        ref.read(enhancedImageUrlProvider.notifier).state = previewPath;

        // Step B：后台请求服务端高质量增强，成功则替换 URL
        unawaited(() async {
          try {
            final base64 = base64Encode(previewJpegBytes);
            final style = ref.read(enhanceStyleProvider);
            final url = await api.enhance(
              uid: uid,
              bestPhotoBase64: base64,
              promptStyle: style,
            );
            ref.read(enhancedImageUrlProvider.notifier).state = url;
            await StorageService.addHistory(
              enhancedUrl: url,
              score: result.attractionScore.overallAttractiveness,
            );
          } catch (_) {
            // 保留本地预览即可
          }
        }());
      }
    } catch (e, st) {
      debugPrint('Analyze error: $e $st');
      ref.read(analysisErrorProvider.notifier).state =
          e.toString().replaceFirst(RegExp(r'^.*?Exception:?\s*'), '');
    } finally {
      ref.read(analysisLoadingProvider.notifier).state = false;
    }
  };
});

/// 图片美化模块：允许单张即可评分（与购买无关）
final enhanceAnalyzeProvider = Provider<Future<void> Function()>((ref) {
  return () async {
    final photos = ref.read(photoProvider);
    const minRequired = 1;
    if (photos.length < minRequired) return;

    ref.read(analysisLoadingProvider.notifier).state = true;
    ref.read(analysisErrorProvider.notifier).state = null;
    ref.read(enhancedImageUrlProvider.notifier).state = null;

    try {
      final uid = await ref.read(uidProvider.future);
      final base64List = await Future.wait(
        photos.map(
          (p) => compressAndEncode(
            p.file,
            maxWidth: 1024,
            quality: 80,
          ),
        ),
      );

      final api = ref.read(apiServiceProvider);
      final lang = LocaleService.getLanguageCode();
      final result = await api.analyze(
        uid: uid,
        photosBase64: base64List,
        lang: lang,
      );
      ref.read(analysisResultProvider.notifier).state = result;

      // 记录「图片美化」分析历史：每张图一条（按 uid）
      final sessionId = DateTime.now().millisecondsSinceEpoch.toString();
      ref.read(enhanceSessionIdProvider.notifier).state = sessionId;
      for (final r in result.rankedPhotos) {
        final idx = r.index;
        final path =
            (idx >= 0 && idx < photos.length) ? photos[idx].file.path : null;
        await StorageService.addAnalysisHistoryEntry(
          uid: uid,
          entry: {
            'id': '$sessionId:$idx',
            'sessionId': sessionId,
            'ts': DateTime.now().toIso8601String(),
            'photoIndex': idx,
            'photoPath': path,
            'score': r.score,
            'reason': r.reason,
            'firstImpressionPrediction': r.firstImpressionPrediction,
            'swipeProbability': r.swipeProbability,
            'improvementTip': r.improvementTip,
            'confidenceImpact': r.confidenceImpact,
          },
        );
      }
      ref.invalidate(enhanceAnalysisHistoryProvider);
    } catch (e, st) {
      debugPrint('Enhance analyze error: $e $st');
      ref.read(analysisErrorProvider.notifier).state =
          e.toString().replaceFirst(RegExp(r'^.*?Exception:?\s*'), '');
    } finally {
      ref.read(analysisLoadingProvider.notifier).state = false;
    }
  };
});

/// 结果页「按当前风格重新美化」：用 enhanceStyleProvider 的 style 再调一次 /enhance
final reEnhanceWithStyleProvider = Provider<Future<void> Function()>((ref) {
  return () async {
    final result = ref.read(analysisResultProvider);
    final photos = ref.read(photoProvider);
    if (result == null || photos.isEmpty || result.rankedPhotos.isEmpty) return;
    final bestIndex = result.rankedPhotos.first.index;
    if (bestIndex >= photos.length) return;
    ref.read(reEnhanceLoadingProvider.notifier).state = true;
    try {
      final uid = await ref.read(uidProvider.future);
      final base64 = await compressAndEncode(
        photos[bestIndex].file,
        maxWidth: 1280,
        quality: 86,
      );
      final api = ref.read(apiServiceProvider);
      final style = ref.read(enhanceStyleProvider);
      final url = await api.enhance(
        uid: uid,
        bestPhotoBase64: base64,
        promptStyle: style,
      );
      ref.read(enhancedImageUrlProvider.notifier).state = url;
    } catch (_) {
      // 失败时不清空旧图，交由调用方提示。
      rethrow;
    } finally {
      ref.read(reEnhanceLoadingProvider.notifier).state = false;
    }
  };
});
