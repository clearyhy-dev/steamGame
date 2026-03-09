import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/localization/app_strings.dart';
import '../../core/theme/app_theme.dart';
import '../../providers/app_providers.dart';
import '../../services/auth_service.dart';
import '../../services/storage_service.dart';

/// AI Feminine Presence Studio 欧美女性专版首页
class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  bool _signingIn = false;

  static const List<({String? code, String label})> _languageOptions = [
    (code: null, label: '跟随系统'),
    (code: 'en', label: 'English'),
    (code: 'ja', label: '日本語'),
    (code: 'ko', label: '한국어'),
    (code: 'zh', label: '中文'),
  ];

  Future<void> _showLanguageSheet() async {
    final current = StorageService.languageOverride;
    if (!mounted) return;
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: appSurfaceCard,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (ctx) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(vertical: 16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 20),
                child: Text(
                  '语言 / Language',
                  style: GoogleFonts.inter(
                    fontSize: 16,
                    fontWeight: FontWeight.w600,
                    color: appCreamWhite,
                  ),
                ),
              ),
              const SizedBox(height: 12),
              ..._languageOptions.map((opt) => ListTile(
                title: Text(
                  opt.label,
                  style: GoogleFonts.inter(
                    fontSize: 15,
                    color: (opt.code == current)
                        ? appCreamGold
                        : appCreamWhite,
                  ),
                ),
                trailing: (opt.code == current)
                    ? Icon(Icons.check, color: appCreamGold, size: 22)
                    : null,
                onTap: () async {
                  await StorageService.setLanguageOverride(opt.code);
                  ref.read(languageOverrideProvider.notifier).state = opt.code;
                  if (ctx.mounted) Navigator.of(ctx).pop();
                },
              )),
            ],
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final purchased = ref.watch(purchasedProvider);
    final authState = ref.watch(authStateProvider);
    ref.watch(languageOverrideProvider);

    return Scaffold(
      backgroundColor: appSurfaceDark,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24),
          child: Column(
            children: [
              const SizedBox(height: 24),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IconButton(
                        icon: Icon(Icons.history, color: appCreamWhite),
                        onPressed: () =>
                            Navigator.of(context).pushNamed('/history'),
                      ),
                      IconButton(
                        icon: Icon(Icons.language, color: appCreamWhite),
                        tooltip: '语言 / Language',
                        onPressed: _showLanguageSheet,
                      ),
                    ],
                  ),
                  Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      _buildAuthButton(authState),
                      const SizedBox(width: 8),
                      if (!purchased)
                        GestureDetector(
                          onTap: () =>
                              Navigator.of(context).pushNamed('/paywall'),
                          child: Container(
                            padding: const EdgeInsets.symmetric(
                                horizontal: 12, vertical: 6),
                            decoration: BoxDecoration(
                              gradient: LinearGradient(
                                colors: [appCreamGold, appCreamGoldMuted],
                                begin: Alignment.topLeft,
                                end: Alignment.bottomRight,
                              ),
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Icon(Icons.workspace_premium,
                                    size: 18, color: Colors.black),
                                const SizedBox(width: 6),
                                Text(
                                  'Premium',
                                  style: GoogleFonts.inter(
                                    fontSize: 13,
                                    fontWeight: FontWeight.w600,
                                    color: Colors.black,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        )
                      else
                        const SizedBox(width: 48),
                    ],
                  ),
                ],
              ),
              if (purchased) const SizedBox(height: 4),
              const Spacer(flex: 1),
              // Hero 标题
              Text(
                AppStrings.homeTitle,
                style: GoogleFonts.playfairDisplay(
                  fontSize: 28,
                  fontWeight: FontWeight.bold,
                  color: appCreamWhite,
                ),
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 12),
              Text(
                AppStrings.homeSubtitle,
                style: GoogleFonts.inter(
                  fontSize: 16,
                  color: appLightGray,
                  height: 1.4,
                ),
                textAlign: TextAlign.center,
              ),
              const Spacer(flex: 1),
              // 三大功能模块入口：点哪个模块，就在模块内选图并上传处理
              _FeatureCard(
                icon: Icons.auto_awesome,
                title: '✨ ${AppStrings.resultEnhancement}',
                subtitle: AppStrings.resultEnhanceHint,
                onTap: () {
                  // 进入图片美化模块前，清理上一次上传/分析/美化状态
                  ref.read(photoProvider.notifier).clear();
                  ref.read(analysisResultProvider.notifier).state = null;
                  ref.read(analysisErrorProvider.notifier).state = null;
                  ref.read(enhancedImageUrlProvider.notifier).state = null;
                  ref.read(enhanceUrlByIndexProvider.notifier).state = <int, String>{};
                  ref.read(enhanceLoadingByIndexProvider.notifier).state = <int, bool>{};
                  Navigator.of(context).pushNamed('/enhance');
                },
              ),
              const SizedBox(height: 12),
              _FeatureCard(
                icon: Icons.photo_library_outlined,
                title: '✨ ${AppStrings.sceneTransformationTitle}',
                subtitle: AppStrings.featureElegantBg,
                onTap: () {
                  ref.read(backgroundReplacePhotoProvider.notifier).state = null;
                  Navigator.of(context).pushNamed('/background-select');
                },
              ),
              const SizedBox(height: 12),
              _FeatureCard(
                icon: Icons.workspace_premium,
                title: '✨ ${AppStrings.headwearTitle}',
                subtitle: AppStrings.applyHeadpiece,
                onTap: () => Navigator.of(context).pushNamed('/hat'),
              ),
              const Spacer(flex: 2),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildAuthButton(AsyncValue<User?> authState) {
    if (authState.isLoading) {
      return SizedBox(
        width: 24,
        height: 24,
        child: CircularProgressIndicator(strokeWidth: 2, color: appCreamWhite),
      );
    }
    final user = authState.valueOrNull;
    if (user != null) {
      final name = user.displayName?.trim().isNotEmpty == true
          ? user.displayName!
          : (user.email ?? '');
      return Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Padding(
            padding: const EdgeInsets.only(right: 8),
            child: Text(
              name.isEmpty ? '已登录' : name,
              style: GoogleFonts.inter(fontSize: 13, color: appCreamWhite),
              maxLines: 1,
              overflow: TextOverflow.ellipsis,
            ),
          ),
          TextButton(
            onPressed: _signingIn
                ? null
                : () async {
                    setState(() => _signingIn = true);
                    await AuthService.signOut();
                    if (mounted) setState(() => _signingIn = false);
                  },
            style: TextButton.styleFrom(
              minimumSize: Size.zero,
              padding: const EdgeInsets.symmetric(horizontal: 8),
              tapTargetSize: MaterialTapTargetSize.shrinkWrap,
            ),
            child: Text(
              'Sign out',
              style: GoogleFonts.inter(fontSize: 12, color: appLightGray),
            ),
          ),
        ],
      );
    }
    return TextButton(
      onPressed: _signingIn
          ? null
          : () async {
              setState(() => _signingIn = true);
              try {
                await AuthService.signInWithGoogle();
              } catch (e) {
                if (mounted) {
                  final msg = e.toString().replaceFirst(RegExp(r'^Exception:\s*'), '');
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text('Google 登录失败: $msg'),
                      backgroundColor: Colors.red.shade800,
                      duration: const Duration(seconds: 5),
                    ),
                  );
                }
              }
              if (mounted) setState(() => _signingIn = false);
            },
      child: _signingIn
          ? SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(
                  strokeWidth: 2, color: appCreamWhite),
            )
          : Text(
              'Sign in with Google',
              style: GoogleFonts.inter(fontSize: 13, color: appCreamGold),
            ),
    );
  }
}

class _FeatureCard extends StatelessWidget {
  final IconData icon;
  final String title;
  final String subtitle;
  final VoidCallback? onTap;

  const _FeatureCard({
    required this.icon,
    required this.title,
    required this.subtitle,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: appSurfaceCard,
          borderRadius: BorderRadius.circular(24),
          border: Border.all(color: Colors.white.withOpacity(0.06)),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: appCreamGold.withOpacity(0.15),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Icon(icon, color: appCreamGold, size: 28),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: GoogleFonts.inter(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: appCreamWhite,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    subtitle,
                    style: GoogleFonts.inter(
                      fontSize: 13,
                      color: appLightGray,
                    ),
                  ),
                ],
              ),
            ),
            if (onTap != null)
              Icon(Icons.chevron_right, color: appLightGray),
          ],
        ),
      ),
    );
  }
}
