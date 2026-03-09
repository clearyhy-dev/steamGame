import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:image/image.dart' as img;

import '../../core/localization/app_strings.dart';
import '../../core/theme/app_theme.dart';
import '../../widgets/background_placeholder.dart';
import 'background_replacement_service.dart';
import 'background_result_screen.dart';

/// 调整人物大小和位置后合成（任意位置 + 任意大小，导出与预览一致）
class BackgroundAdjustScreen extends ConsumerStatefulWidget {
  const BackgroundAdjustScreen({
    super.key,
    required this.backgroundId,
    required this.backgroundName,
    required this.backgroundAssetPath,
    required this.extractedPersonPng,
  });

  final String backgroundId;
  final String backgroundName;
  final String backgroundAssetPath;
  final File extractedPersonPng;

  static const routeName = '/background-adjust';

  @override
  ConsumerState<BackgroundAdjustScreen> createState() =>
      _BackgroundAdjustScreenState();
}

class _BackgroundAdjustScreenState extends ConsumerState<BackgroundAdjustScreen> {
  double _userScale = 1.0;
  double _baseFitScale = 1.0;
  double _offsetX = 0.0;
  double _offsetY = 0.0;
  double _startScale = 1.0;
  double _startX = 0.0;
  double _startY = 0.0;
  int _canvasW = 0;
  int _canvasH = 0;
  bool _layoutReady = false;
  double _bgAspect = 4 / 3;
  bool _bgAspectReady = false;
  bool _replacing = false;
  String? _error;
  File? _resultFile;

  
  @override
  void initState() {
    super.initState();
    _loadBackgroundAspect();
  }

  void _loadBackgroundAspect() {
    final provider = AssetImage(widget.backgroundAssetPath);
    final stream = provider.resolve(const ImageConfiguration());
    late final ImageStreamListener listener;
    listener = ImageStreamListener((ImageInfo info, bool _) {
      final w = info.image.width.toDouble();
      final h = info.image.height.toDouble();
      if (w > 0 && h > 0 && mounted) {
        setState(() {
          _bgAspect = h / w;
          _bgAspectReady = true;
          _layoutReady = false; // 触发重新计算画布与默认位置
        });
      }
      stream.removeListener(listener);
    }, onError: (error, stackTrace) {
      // 保持默认比例
      stream.removeListener(listener);
    });
    stream.addListener(listener);
  }

void _onScaleStart(ScaleStartDetails d) {
    _startScale = _userScale;
    _startX = _offsetX;
    _startY = _offsetY;
  }

  void _onScaleUpdate(ScaleUpdateDetails d) {
    setState(() {
      _userScale = (_startScale * d.scale).clamp(0.1, 6.0);
      _offsetX = _startX + d.focalPointDelta.dx;
      _offsetY = _startY + d.focalPointDelta.dy;
    });
  }

  Future<void> _export({int maxSide = 1024}) async {
    if (_canvasW <= 0 || _canvasH <= 0) {
      setState(() => _error = '画布未就绪');
      return;
    }
    setState(() {
      _replacing = true;
      _error = null;
      _resultFile = null;
    });
    try {
      final out = await BackgroundReplacementService.compositeWithTransform(
        extractedPersonPng: widget.extractedPersonPng,
        backgroundAssetPath: widget.backgroundAssetPath,
        userScale: _userScale,
        offsetX: _offsetX,
        offsetY: _offsetY,
        baseFitScale: _baseFitScale,
        canvasW: _canvasW,
        canvasH: _canvasH,
        maxSide: maxSide,
      );
      if (!mounted) return;
      if (out != null) {
        setState(() => _resultFile = out);
        Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => BackgroundResultScreen(resultFile: out),
          ),
        );
      } else {
        setState(() => _error = '合成失败，请重试');
      }
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString().replaceFirst(RegExp(r'^.*?Exception:?\s*'), ''));
      }
    } finally {
      if (mounted) setState(() => _replacing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: appSurfaceDark,
      appBar: AppBar(
        title: Text(
          AppStrings.positionAndSize,
          style: GoogleFonts.merriweather(fontWeight: FontWeight.w600),
        ),
        centerTitle: true,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              AppStrings.dragFrameHint,
              style: GoogleFonts.inter(fontSize: 13, color: Colors.white70),
            ),
            const SizedBox(height: 12),
            _buildPreview(),
            const SizedBox(height: 16),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  _error!,
                  style: const TextStyle(color: Colors.red, fontSize: 13),
                ),
              ),
            FilledButton.icon(
              onPressed: _replacing ? null : () => _export(maxSide: 1024),
              icon: _replacing
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.auto_fix_high),
              label: Text(_replacing ? AppStrings.replacing : AppStrings.replaceAndSave),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildPreview() {
    return LayoutBuilder(
      builder: (context, c) {
        final cw = c.maxWidth;
        final ch = cw * _bgAspect;

        if (cw > 0 && ch > 0 && (!_layoutReady || _canvasW != cw.round() || _canvasH != ch.round())) {
          _layoutReady = true;
          _canvasW = cw.round();
          _canvasH = ch.round();
          WidgetsBinding.instance.addPostFrameCallback((_) async {
            final bytes = await widget.extractedPersonPng.readAsBytes();
            final fg = img.decodeImage(bytes);
            if (fg == null || !mounted) return;

            final pw = fg.width.toDouble();
            final ph = fg.height.toDouble();
            final fitW = cw / pw;
            final fitH = ch / ph;
            final fit = (fitW < fitH ? fitW : fitH) * 0.9;
            final displayW = pw * fit;
            final displayH = ph * fit;

            setState(() {
              _baseFitScale = fit;
              _offsetX = (cw - displayW) / 2;
              _offsetY = (ch - displayH) / 2;
            });
          });
        }

        return SizedBox(
          width: cw,
          height: ch,
          child: GestureDetector(
            onScaleStart: _onScaleStart,
            onScaleUpdate: _onScaleUpdate,
            child: Stack(
              fit: StackFit.expand,
              clipBehavior: Clip.none,
              children: [
                ClipRRect(
                  borderRadius: BorderRadius.circular(12),
                  child: Image.asset(
                    widget.backgroundAssetPath,
                    fit: BoxFit.cover,
                  ),
                ),
                Positioned(
                  left: _offsetX,
                  top: _offsetY,
                  child: Transform.scale(
                    alignment: Alignment.topLeft,
                    scale: _userScale,
                    child: Transform.scale(
                      alignment: Alignment.topLeft,
                      scale: _baseFitScale,
                      child: Image.file(widget.extractedPersonPng),
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}
