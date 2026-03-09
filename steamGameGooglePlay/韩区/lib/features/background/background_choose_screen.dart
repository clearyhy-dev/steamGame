import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/theme/app_theme.dart';
import '../../providers/app_providers.dart';
import '../../widgets/background_placeholder.dart';
import 'background_adjust_screen.dart';

/// 选择背景进行合成：展示系统基础背景列表，点击后合成并进入结果页。
class BackgroundChooseScreen extends ConsumerStatefulWidget {
  const BackgroundChooseScreen({super.key});

  @override
  ConsumerState<BackgroundChooseScreen> createState() =>
      _BackgroundChooseScreenState();
}

class _BackgroundChooseScreenState extends ConsumerState<BackgroundChooseScreen> {
  List<Map<String, dynamic>> _backgrounds = [];
  bool _loading = true;
  String? _compositeError;

  static const List<Map<String, String>> _defaultBackgrounds = [
    {'id': 'beach_sunset', 'name': '海滩日落'},
    {'id': 'luxury_cafe', 'name': '奢华咖啡厅'},
    {'id': 'modern_office', 'name': '现代办公室'},
    {'id': 'cozy_home', 'name': '温馨家居'},
    {'id': 'paris_street', 'name': '巴黎街景'},
    {'id': 'soft_studio', 'name': '柔和影棚'},
  ];

  @override
  void initState() {
    super.initState();
    _loadBackgrounds();
  }

  Future<void> _loadBackgrounds() async {
    setState(() => _loading = true);
    try {
      final api = ref.read(apiServiceProvider);
      final list = await api.listBackgrounds();
      if (mounted && list.isNotEmpty) setState(() => _backgrounds = list);
      else if (mounted) setState(() => _backgrounds = _defaultBackgrounds.map((e) => Map<String, dynamic>.from(e)).toList());
    } catch (_) {
      if (mounted) setState(() => _backgrounds = _defaultBackgrounds.map((e) => Map<String, dynamic>.from(e)).toList());
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  void _onBackgroundTap(String backgroundId, String name) {
    final extracted = ref.read(extractedPersonFileProvider);
    if (extracted == null) {
      setState(() => _compositeError = '请先完成人像提取');
      return;
    }
    setState(() => _compositeError = null);
    final assetPath = 'assets/backgrounds/$backgroundId.jpg';
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => BackgroundAdjustScreen(
          backgroundId: backgroundId,
          backgroundName: name,
          backgroundAssetPath: assetPath,
          extractedPersonPng: extracted,
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final extracted = ref.watch(extractedPersonFileProvider);

    return Scaffold(
      backgroundColor: appSurfaceDark,
      appBar: AppBar(
        title: Text(
          '选择背景',
          style: GoogleFonts.merriweather(fontWeight: FontWeight.w600),
        ),
        centerTitle: true,
      ),
      body: extracted == null
          ? Center(
              child: Text(
                '请先完成人像提取',
                style: GoogleFonts.inter(color: appLightGray),
              ),
            )
          : ListView(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
              children: [
                Text(
                  '系统提供的基础背景，点击即可合成',
                  style: GoogleFonts.inter(fontSize: 13, color: appLightGray),
                ),
                const SizedBox(height: 12),
                if (_compositeError != null)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Text(_compositeError!, style: TextStyle(color: Colors.red.shade200, fontSize: 12)),
                  ),
                if (_loading)
                  const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()))
                else
                  GridView.count(
                    shrinkWrap: true,
                    physics: const NeverScrollableScrollPhysics(),
                    crossAxisCount: 2,
                    mainAxisSpacing: 12,
                    crossAxisSpacing: 12,
                    childAspectRatio: 0.85,
                    children: List.generate(_backgrounds.length, (i) {
                      final bg = _backgrounds[i];
                      final id = bg['id'] as String? ?? '';
                      final name = bg['name'] as String? ?? id;
                      return _BackgroundTile(
                        backgroundId: id,
                        name: name,
                        assetPath: 'assets/backgrounds/$id.jpg',
                        onTap: () => _onBackgroundTap(id, name),
                      );
                    }),
                  ),
              ],
            ),
    );
  }
}

class _BackgroundTile extends StatelessWidget {
  final String backgroundId;
  final String name;
  final String assetPath;
  final VoidCallback onTap;

  const _BackgroundTile({
    required this.backgroundId,
    required this.name,
    required this.assetPath,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: appSurfaceCard,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: appLightGray.withOpacity(0.4)),
        ),
        child: Stack(
          fit: StackFit.expand,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: BackgroundPlaceholder(
                assetPath: assetPath,
                fit: BoxFit.cover,
                borderRadius: BorderRadius.zero,
              ),
            ),
            Positioned(
              left: 0,
              right: 0,
              bottom: 0,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 8),
                decoration: BoxDecoration(
                  borderRadius: const BorderRadius.vertical(bottom: Radius.circular(12)),
                  gradient: LinearGradient(
                    begin: Alignment.topCenter,
                    end: Alignment.bottomCenter,
                    colors: [Colors.transparent, Colors.black54],
                  ),
                ),
                child: Text(
                  name,
                  textAlign: TextAlign.center,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.inter(fontSize: 12, color: Colors.white, fontWeight: FontWeight.w500),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
