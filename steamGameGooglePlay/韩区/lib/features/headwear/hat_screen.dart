import 'dart:io';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:image_picker/image_picker.dart';

import 'hat_processor.dart';
import '../../core/localization/app_strings.dart';
import '../../core/theme/app_theme.dart';

/// 头饰独立页：本地 ML Kit 人脸检测 + image 叠加，无需后端。
class HatScreen extends ConsumerStatefulWidget {
  final File? initialImage;

  const HatScreen({super.key, this.initialImage});

  @override
  ConsumerState<HatScreen> createState() => _HatScreenState();
}

class _HatScreenState extends ConsumerState<HatScreen> {
  File? _selectedImage;
  File? _resultImage;
  String _selectedHat = 'assets/hats/gold_crown.png';
  bool _loading = false;
  String? _error;

  /// 兜底列表：当 AssetManifest 未解析到 assets/hats 时使用（与目录内文件一致）
  static const List<String> _hatAssetsFallback = [
    'assets/hats/gold_crown.png',
    'assets/hats/flower_halo.png',
    'assets/hats/angel_halo.png',
    'assets/hats/cat_ear.png',
    'assets/hats/santa_hat.png',
  ];

  List<String> _hatAssets = _hatAssetsFallback;

  @override
  void initState() {
    super.initState();
    _selectedImage = widget.initialImage;
    _loadHatAssets();
  }

  /// 从 AssetManifest 读取 assets/hats 下所有图片，作为头饰可选列表（与目录一致）
  Future<void> _loadHatAssets() async {
    try {
      final manifestStr = await rootBundle.loadString('AssetManifest.json');
      final Map<String, dynamic> manifest = jsonDecode(manifestStr);
      final List<String> fromManifest = [];
      for (final k in manifest.keys) {
        final lower = k.toLowerCase();
        if (!lower.contains('assets/hats/')) continue;
        if (!lower.endsWith('.png') &&
            !lower.endsWith('.webp') &&
            !lower.endsWith('.jpg') &&
            !lower.endsWith('.jpeg')) continue;
        final path = k.replaceFirst(RegExp(r'^.*?assets/hats/'), 'assets/hats/');
        if (!path.startsWith('assets/hats/')) continue;
        fromManifest.add(path);
      }
      final unique = fromManifest.toSet().toList()..sort();
      if (mounted) {
        setState(() {
          _hatAssets = unique.isNotEmpty ? unique : _hatAssetsFallback;
          if (_hatAssets.isNotEmpty && !_hatAssets.contains(_selectedHat)) {
            _selectedHat = _hatAssets.first;
          }
        });
      }
    } catch (_) {
      _hatAssets = _hatAssetsFallback;
    }
  }

  static String _hatEmoji(String path) {
    final p = path.toLowerCase();
    if (p.contains('crown') && p.contains('gold')) return '👑';
    if (p.contains('flower') || p.contains('halo')) return '🌸';
    if (p.contains('santa')) return '🎅';
    if (p.contains('christmas')) return '🎄';
    if (p.contains('deer')) return '🦌';
    if (p.contains('headband') || p.contains('pearl')) return '👸';
    if (p.contains('cartoon')) return '🎀';
    return '🎩';
  }

  /// 按头饰类型：皇冠上浮一点，花环保持当前，其余适配头的大小（锚点+下沉+缩放）。
  (bool usePremium, double scaleMultiplier, double anchorRatio, double sink)
      _hatConfig(String hatPath) {
    final p = hatPath.toLowerCase();
    if (p.contains('crown')) {
      // 皇冠：贴头顶、略下沉、尺寸适中不显大
      return (true, 1.18, 0.25, 0.02);
    }
    if (p.contains('halo') || p.contains('flower') || p.contains('wreath') ||
        p.contains('angel')) {
      // 花环/天使环：当前效果合适，保持
      return (false, 1.22, 0.25, 0.04);
    }
    if (p.contains('headband') || p.contains('pearl') || p.contains('cat_ear')) {
      return (false, 1.20, 0.24, 0.03);
    }
    if (p.contains('deer') || p.contains('christmas') || p.contains('santa')) {
      return (false, 1.22, 0.24, 0.04);
    }
    return (false, 1.22, 0.24, 0.04);
  }

  Future<void> _pickImage() async {
    final picker = ImagePicker();
    final picked = await picker.pickImage(source: ImageSource.gallery);
    if (picked != null && mounted) {
      setState(() {
        _selectedImage = File(picked.path);
        _resultImage = null;
        _error = null;
      });
    }
  }

  Future<void> _applyHat() async {
    if (_selectedImage == null) return;

    setState(() {
      _loading = true;
      _error = null;
      _resultImage = null;
    });

    try {
      final byteData = await rootBundle.load(_selectedHat);
      final hatBytes = byteData.buffer.asUint8List();
      final cfg = _hatConfig(_selectedHat);
      final file = await HatProcessor.addHat(
        imageFile: _selectedImage!,
        hatBytes: hatBytes,
        usePremiumCrown: cfg.$1,
        scaleMultiplier: cfg.$2,
        anchorRatio: cfg.$3,
        sink: cfg.$4,
      );
      if (!mounted) return;
      setState(() {
        _loading = false;
        _resultImage = file;
        if (file == null) _error = AppStrings.noSuitableFace;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = e.toString().replaceFirst(RegExp(r'^.*?Exception:?\s*'), '');
      });
    }
  }

  Widget _hatItem(String path) {
    final selected = _selectedHat == path;
    return GestureDetector(
      onTap: () => setState(() => _selectedHat = path),
      child: Container(
        margin: const EdgeInsets.symmetric(horizontal: 8),
        padding: const EdgeInsets.all(6),
        decoration: BoxDecoration(
          border: Border.all(
            color: selected ? appGoldPrimary : appLightGray,
            width: selected ? 2 : 1,
          ),
          borderRadius: BorderRadius.circular(14),
          color: appSurfaceCard,
        ),
        child: Image.asset(
          path,
          width: 50,
          height: 50,
          fit: BoxFit.contain,
          errorBuilder: (_, __, ___) => Center(
            child: Text(
              _hatEmoji(path),
              style: const TextStyle(fontSize: 28),
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: appSurfaceDark,
      appBar: AppBar(
        title: Text(
          AppStrings.headwearTitle,
          style: GoogleFonts.playfairDisplay(
            fontSize: 18,
            fontWeight: FontWeight.w600,
            color: appCreamWhite,
          ),
        ),
        backgroundColor: appSurfaceDark,
        foregroundColor: appCreamWhite,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                AppStrings.selectPhoto,
                style: GoogleFonts.inter(
                  fontSize: 14,
                  fontWeight: FontWeight.w600,
                  color: appCreamWhite,
                ),
              ),
              FilledButton.icon(
                onPressed: _loading ? null : _pickImage,
                icon: const Icon(Icons.photo_library_outlined, size: 18),
                label: Text(AppStrings.selectPhoto),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (_selectedImage == null)
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: appSurfaceCard,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.white.withOpacity(0.06)),
              ),
              child: Text(
                '选择一张照片后，挑选头饰并点击「${AppStrings.applyHeadpiece}」。',
                style: GoogleFonts.inter(color: appLightGray, fontSize: 12),
              ),
            )
          else
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Image.file(
                _selectedImage!,
                height: 240,
                width: double.infinity,
                fit: BoxFit.cover,
              ),
            ),
          const SizedBox(height: 14),
          Text(
            AppStrings.applyHeadpiece,
            style: GoogleFonts.inter(
              color: appCreamWhite,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: _hatAssets.map((e) => _hatItem(e)).toList(),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(
              _error!,
              style: GoogleFonts.inter(color: Colors.orange, fontSize: 12),
              textAlign: TextAlign.center,
            ),
          ],
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _loading || _selectedImage == null ? null : _applyHat,
              style: ElevatedButton.styleFrom(
                backgroundColor: appCreamGold,
                foregroundColor: Colors.black,
                padding: const EdgeInsets.symmetric(vertical: 14),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(16),
                ),
              ),
              child: _loading
                  ? const SizedBox(
                      width: 22,
                      height: 22,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Text(
                      AppStrings.applyHeadpiece,
                      style: GoogleFonts.inter(
                          fontSize: 16, fontWeight: FontWeight.w600),
                    ),
            ),
          ),
          const SizedBox(height: 18),
          Text(
            AppStrings.result,
            style: GoogleFonts.inter(
              color: appCreamWhite,
              fontWeight: FontWeight.w600,
            ),
          ),
          const SizedBox(height: 8),
          if (_resultImage == null)
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: appSurfaceCard,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.white.withOpacity(0.06)),
              ),
              child: Text(
                '处理完成后会在这里显示结果图。',
                style: GoogleFonts.inter(color: appLightGray, fontSize: 12),
              ),
            )
          else
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Image.file(
                _resultImage!,
                height: 320,
                width: double.infinity,
                fit: BoxFit.cover,
              ),
            ),
        ],
      ),
    );
  }
}
