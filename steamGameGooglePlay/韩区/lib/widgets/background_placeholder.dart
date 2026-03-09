import 'package:flutter/material.dart';

/// 背景占位：assets 无图时显示渐变，避免白屏
class BackgroundPlaceholder extends StatelessWidget {
  const BackgroundPlaceholder({
    super.key,
    required this.assetPath,
    this.fit = BoxFit.cover,
    this.borderRadius = BorderRadius.zero,
  });

  final String assetPath;
  final BoxFit fit;
  final BorderRadius borderRadius;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: borderRadius,
      child: Stack(
        fit: StackFit.expand,
        children: [
          DecoratedBox(
            decoration: BoxDecoration(
              gradient: LinearGradient(
                begin: Alignment.topCenter,
                end: Alignment.bottomCenter,
                colors: [
                  const Color(0xFF4A6FA5),
                  const Color(0xFF6B8CAE),
                  const Color(0xFF8B9E7C),
                  const Color(0xFFB5A67A),
                ],
                stops: const [0.0, 0.4, 0.7, 1.0],
              ),
            ),
          ),
          Image.asset(
            assetPath,
            fit: fit,
            errorBuilder: (_, __, ___) => const SizedBox.shrink(),
          ),
        ],
      ),
    );
  }
}
