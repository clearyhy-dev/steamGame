import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:image_picker/image_picker.dart';

import '../../core/constants/app_constants.dart';
import '../../core/theme/app_theme.dart';
import '../../core/localization/app_strings.dart';
import '../../providers/app_providers.dart';

class UploadScreen extends ConsumerWidget {
  const UploadScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final photos = ref.watch(photoProvider);
    final purchased = ref.watch(purchasedProvider);
    final error = ref.watch(analysisErrorProvider);

    final maxPhotosForUser = purchased ? AppConstants.maxPhotos : AppConstants.maxPhotosFree;
    final minPhotosForUser = purchased ? AppConstants.minPhotos : AppConstants.minPhotosFree;

    return Scaffold(
      backgroundColor: appSurfaceDark,
      appBar: AppBar(
        leading: IconButton(
          icon: Icon(Icons.arrow_back, color: Colors.white),
          onPressed: () => Navigator.of(context).pushReplacementNamed('/'),
        ),
        title: Text(
          AppStrings.uploadTitle,
          style: GoogleFonts.merriweather(fontWeight: FontWeight.w600),
        ),
        centerTitle: true,
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                Text(
                  AppStrings.uploadHint,
                  style: GoogleFonts.inter(color: Colors.white70, fontSize: 14),
                ),
                if (error != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    error,
                    style: TextStyle(color: Colors.red.shade300, fontSize: 13),
                    textAlign: TextAlign.center,
                  ),
                ],
              ],
            ),
          ),
          Expanded(
            child: GridView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                crossAxisCount: 3,
                crossAxisSpacing: 8,
                mainAxisSpacing: 8,
                childAspectRatio: 0.85,
              ),
              itemCount: photos.length < maxPhotosForUser
                  ? photos.length + 1
                  : photos.length,
              itemBuilder: (_, index) {
                if (index == photos.length && photos.length < maxPhotosForUser) {
                  return _AddPhotoTile(
                    onTap: () => _pickImage(context, ref),
                  );
                }
                final photo = photos[index];
                return _PhotoTile(
                  file: photo.file,
                  onRemove: () => ref.read(photoProvider.notifier).removeAt(index),
                );
              },
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(24),
            child: SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: photos.length >= minPhotosForUser
                    ? () {
                        Navigator.of(context).pushReplacementNamed('/analysis');
                      }
                    : null,
                child: Text(AppStrings.analyze),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _pickImage(BuildContext context, WidgetRef ref) async {
    final picker = ImagePicker();
    final x = await picker.pickImage(source: ImageSource.gallery);
    if (x == null) return;
    final purchased = ref.read(purchasedProvider);
    final maxForUser = purchased ? AppConstants.maxPhotos : AppConstants.maxPhotosFree;
    ref.read(photoProvider.notifier).add(File(x.path), maxPhotos: maxForUser);
  }
}

class _AddPhotoTile extends StatelessWidget {
  final VoidCallback onTap;

  const _AddPhotoTile({required this.onTap});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: appSurfaceCard,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: Colors.white12),
        ),
        child: Icon(Icons.add_photo_alternate_outlined, size: 40, color: Colors.white54),
      ),
    );
  }
}

class _PhotoTile extends StatelessWidget {
  final File file;
  final VoidCallback onRemove;

  const _PhotoTile({required this.file, required this.onRemove});

  @override
  Widget build(BuildContext context) {
    return Stack(
      fit: StackFit.expand,
      children: [
        ClipRRect(
          borderRadius: BorderRadius.circular(20),
          child: Image.file(file, fit: BoxFit.cover),
        ),
        Positioned(
          top: 4,
          right: 4,
          child: GestureDetector(
            onTap: onRemove,
            child: const CircleAvatar(
              radius: 14,
              backgroundColor: Colors.black54,
              child: Icon(Icons.close, size: 18, color: Colors.white),
            ),
          ),
        ),
      ],
    );
  }
}
