import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/localization/app_strings.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/app_providers.dart';
import 'extracted_person_screen.dart';

class BackgroundSelectScreen extends ConsumerStatefulWidget {
  const BackgroundSelectScreen({super.key});

  @override
  ConsumerState<BackgroundSelectScreen> createState() =>
      _BackgroundSelectScreenState();
}

class _BackgroundSelectScreenState extends ConsumerState<BackgroundSelectScreen> {
  Future<void> _pickPhoto() async {
    final picker = ImagePicker();
    final x = await picker.pickImage(source: ImageSource.gallery, imageQuality: 95);
    if (x == null) return;
    ref.read(backgroundReplacePhotoProvider.notifier).state = File(x.path);
    if (mounted) setState(() {});
  }

  void _goToExtractPerson(File photo) {
    Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => ExtractedPersonScreen(photoFile: photo),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final photo = ref.watch(backgroundReplacePhotoProvider);

    return Scaffold(
      backgroundColor: appSurfaceDark,
      appBar: AppBar(
        title: Text(
          AppStrings.sceneTransformationTitle,
          style: GoogleFonts.merriweather(fontWeight: FontWeight.w600),
        ),
        centerTitle: true,
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
                onPressed: _pickPhoto,
                icon: const Icon(Icons.photo_library_outlined, size: 18),
                label: Text(AppStrings.selectPhoto),
              ),
            ],
          ),
          const SizedBox(height: 10),
          if (photo == null)
            Container(
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: appSurfaceCard,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: Colors.white.withOpacity(0.06)),
              ),
              child: Text(
                '选择一张照片后，先提取人像，再选择背景合成。',
                style: GoogleFonts.inter(color: appLightGray, fontSize: 12),
              ),
            )
          else ...[
            ClipRRect(
              borderRadius: BorderRadius.circular(14),
              child: Image.file(
                photo,
                height: 220,
                width: double.infinity,
                fit: BoxFit.cover,
              ),
            ),
            const SizedBox(height: 14),
            FilledButton.icon(
              onPressed: () => _goToExtractPerson(photo),
              icon: const Icon(Icons.person_outline),
              label: const Text('提取人像'),
              style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 14)),
            ),
          ],
        ],
      ),
    );
  }
}
