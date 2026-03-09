import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/theme/app_theme.dart';
import '../../providers/app_providers.dart';
import 'background_replacement_service.dart';

/// 人体提取结果页：展示提取的人像（透明背景，衬在灰色上更自然），再进入选择背景合成。
class ExtractedPersonScreen extends ConsumerStatefulWidget {
  const ExtractedPersonScreen({super.key, required this.photoFile});

  final File photoFile;

  @override
  ConsumerState<ExtractedPersonScreen> createState() =>
      _ExtractedPersonScreenState();
}

class _ExtractedPersonScreenState extends ConsumerState<ExtractedPersonScreen> {
  bool _extracting = true;
  String? _error;
  File? _extractedFile;

  @override
  void initState() {
    super.initState();
    _runExtract();
  }

  Future<void> _runExtract() async {
    setState(() {
      _extracting = true;
      _error = null;
      _extractedFile = null;
    });
    try {
      final file = await BackgroundReplacementService.extractPerson(widget.photoFile, maxSide: 1024);
      if (!mounted) return;
      if (file != null) {
        ref.read(extractedPersonFileProvider.notifier).state = file;
        setState(() => _extractedFile = file);
      } else {
        setState(() => _error = '未能识别人像，请换一张正脸/半身照重试。');
      }
    } catch (e) {
      if (mounted) {
        setState(() => _error = e.toString().replaceFirst(RegExp(r'^.*?Exception:?\s*'), ''));
      }
    } finally {
      if (mounted) setState(() => _extracting = false);
    }
  }

  void _goToChooseBackground() {
    if (_extractedFile == null) return;
    Navigator.of(context).pushReplacementNamed('/background-choose');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: appSurfaceDark,
      appBar: AppBar(
        title: Text(
          '提取人像',
          style: GoogleFonts.merriweather(fontWeight: FontWeight.w600),
        ),
        centerTitle: true,
      ),
      body: _extracting
          ? const Center(
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 16),
                  Text('正在提取人像…', style: TextStyle(color: appLightGray)),
                ],
              ),
            )
          : _error != null
              ? Padding(
                  padding: const EdgeInsets.all(24),
                  child: Column(
                    mainAxisAlignment: MainAxisAlignment.center,
                    children: [
                      Text(_error!, style: TextStyle(color: Colors.red.shade200)),
                      const SizedBox(height: 16),
                      FilledButton.icon(
                        onPressed: _runExtract,
                        icon: const Icon(Icons.refresh),
                        label: const Text('重试'),
                      ),
                    ],
                  ),
                )
              : SingleChildScrollView(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Text(
                        '提取的人像（可在此预览效果）',
                        style: GoogleFonts.inter(
                          fontSize: 13,
                          color: appLightGray,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                      const SizedBox(height: 10),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(16),
                        child: Container(
                          color: const Color(0xFF5A5A5A),
                          width: double.infinity,
                          constraints: const BoxConstraints(minHeight: 280),
                          child: _extractedFile != null
                              ? Image.file(
                                  _extractedFile!,
                                  fit: BoxFit.contain,
                                )
                              : const SizedBox.shrink(),
                        ),
                      ),
                      const SizedBox(height: 20),
                      FilledButton.icon(
                        onPressed: _goToChooseBackground,
                        icon: const Icon(Icons.photo_library),
                        label: const Text('选择背景进行合成'),
                        style: FilledButton.styleFrom(
                          padding: const EdgeInsets.symmetric(vertical: 14),
                        ),
                      ),
                    ],
                  ),
                ),
    );
  }
}
