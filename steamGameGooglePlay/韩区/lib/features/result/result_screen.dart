import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../core/localization/app_strings.dart';
import '../../core/theme/app_theme.dart';
import '../../models/analysis_result_model.dart';
import '../../models/photo_model.dart';
import '../../providers/app_providers.dart';

class ResultScreen extends ConsumerWidget {
  const ResultScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final result = ref.watch(analysisResultProvider);
    final purchased = ref.watch(purchasedProvider);
    final enhancedUrl = ref.watch(enhancedImageUrlProvider);
    final photos = ref.watch(photoProvider);

    if (result == null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        if (context.mounted) {
          Navigator.of(context).pushReplacementNamed('/upload');
        }
      });
      return Scaffold(
        backgroundColor: appSurfaceDark,
        body: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              CircularProgressIndicator(color: appGoldPrimary),
              const SizedBox(height: 16),
              Text(
                AppStrings.loadingResults,
                style: GoogleFonts.inter(color: Colors.white70),
              ),
            ],
          ),
        ),
      );
    }

    final topPhoto =
        result.rankedPhotos.isNotEmpty ? result.rankedPhotos.first : null;
    File? topFile;
    if (topPhoto != null && topPhoto.index < photos.length) {
      topFile = photos[topPhoto.index].file;
    }

    return Scaffold(
      backgroundColor: appSurfaceDark,
      appBar: AppBar(
        title: Text(
          AppStrings.yourPresenceReport,
          style: GoogleFonts.merriweather(fontWeight: FontWeight.w600),
        ),
        centerTitle: true,
        actions: [
          if (!purchased)
            TextButton(
              onPressed: () => Navigator.of(context).pushNamed('/paywall'),
              child: Text(AppStrings.unlockPro),
            ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            _SectionTitle(title: AppStrings.resultScore),
            const SizedBox(height: 8),
            _AttractionScoreCard(score: result.attractionScore),
            const SizedBox(height: 24),

            _SectionTitle(title: AppStrings.resultPsychology),
            const SizedBox(height: 8),
            ...result.rankedPhotos.asMap().entries.map((e) {
              final photo = e.value;
              final file = photo.index < photos.length
                  ? photos[photo.index].file
                  : null;
              return _PhotoPsychologyCard(
                photoIndex: photo.index + 1,
                file: file,
                ranked: photo,
              );
            }),
            const SizedBox(height: 24),

            _SectionTitle(title: AppStrings.resultEnhancement),
            Text(
              AppStrings.resultEnhanceHint,
              style: GoogleFonts.inter(fontSize: 12, color: appLightGray),
            ),
            const SizedBox(height: 8),
            if (topFile != null && enhancedUrl != null)
              _BeforeAfterSlider(
                beforeFile: topFile,
                afterImageUrl: enhancedUrl,
              )
            else if (topFile != null && !purchased)
              _LockedPlaceholder(
                hint: AppStrings.unlockSkinToneHint,
                onUnlock: () => Navigator.of(context).pushNamed('/paywall'),
              )
            else if (topFile != null && enhancedUrl == null)
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(12),
                    child: Image.file(topFile, height: 200, fit: BoxFit.cover),
                  ),
                  const SizedBox(height: 8),
                  Text(
                    AppStrings.enhancedVersionError,
                    style: GoogleFonts.inter(
                      fontSize: 12,
                      color: Colors.orange.shade800,
                    ),
                  ),
                ],
              )
            else if (topFile != null)
              ClipRRect(
                borderRadius: BorderRadius.circular(12),
                child: Image.file(topFile, height: 200, fit: BoxFit.cover),
              ),
            if (topFile != null) ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: () {
                  ref.read(backgroundReplacePhotoProvider.notifier).state = topFile;
                  Navigator.of(context).pushNamed('/background-select');
                },
                icon: const Icon(Icons.photo_library_outlined, size: 20),
                label: Text(AppStrings.sceneTransformation),
              ),
            ],
            if (topFile != null && enhancedUrl != null) ...[
              const SizedBox(height: 16),
              const _EnhanceStyleRow(),
            ],
            if (topFile != null) ...[
              const SizedBox(height: 16),
              OutlinedButton.icon(
                onPressed: () => Navigator.of(context).pushNamed(
                  '/hat',
                  arguments: topFile,
                ),
                icon: const Icon(Icons.auto_awesome, size: 20),
                label: Text(AppStrings.luxuryHeadpiece),
              ),
            ],
            const SizedBox(height: 24),

            _SectionTitle(title: AppStrings.resultBio),
            const SizedBox(height: 8),
            if (result.eliteBios.isNotEmpty)
              ...result.eliteBios.map(
                (b) => _EliteBioCard(
                  style: b.style,
                  text: b.text,
                  whyItWorks: b.whyItWorks,
                ),
              )
            else if (result.bioSuggestions.playful.isNotEmpty)
              ...[
                _EliteBioCard(
                  style: AppStrings.playful,
                  text: result.bioSuggestions.playful,
                  whyItWorks: '',
                ),
                _EliteBioCard(
                  style: AppStrings.confident,
                  text: result.bioSuggestions.confident,
                  whyItWorks: '',
                ),
                _EliteBioCard(
                  style: AppStrings.elegant,
                  text: result.bioSuggestions.elegant,
                  whyItWorks: '',
                ),
              ]
            else
              _LockedPlaceholder(
                hint: AppStrings.unlockBioHint,
                onUnlock: () => Navigator.of(context).pushNamed('/paywall'),
              ),
            const SizedBox(height: 24),

            _SectionTitle(title: AppStrings.resultStrategy),
            const SizedBox(height: 8),
            if (result.matchStrategy.bestPhotoOrder.isNotEmpty ||
                result.matchStrategy.personalBrandKeywords.isNotEmpty ||
                result.matchStrategy.attractiveToMaleTypes.isNotEmpty ||
                result.matchStrategy.stylesToAvoid.isNotEmpty)
              _MatchStrategyCard(report: result.matchStrategy)
            else
              _LockedPlaceholder(
                hint: AppStrings.unlockStrategyHint,
                onUnlock: () => Navigator.of(context).pushNamed('/paywall'),
              ),
          ],
        ),
      ),
    );
  }
}

class _SectionTitle extends StatelessWidget {
  final String title;

  const _SectionTitle({required this.title});

  @override
  Widget build(BuildContext context) {
    return Text(
      title,
      style: GoogleFonts.merriweather(
        fontSize: 18,
        fontWeight: FontWeight.w600,
        color: Colors.white,
      ),
    );
  }
}

const _kEnhanceStyleKeys = [
  'portrait', 'natural_glow', 'luxury_studio', 'soft_feminine',
  'flower_crown', 'princess_tiara', 'butterfly_aura', 'sparkle_light', 'pastel_anime',
];

class _EnhanceStyleRow extends ConsumerWidget {
  const _EnhanceStyleRow();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final style = ref.watch(enhanceStyleProvider);
    final loading = ref.watch(reEnhanceLoadingProvider);
    return Row(
      children: [
        Text(
          AppStrings.styleLabel,
          style: GoogleFonts.inter(fontSize: 13, color: appLightGray),
        ),
        const SizedBox(width: 8),
        DropdownButton<String>(
          value: style,
          isDense: true,
          dropdownColor: appSurfaceCard,
          items: _kEnhanceStyleKeys
              .map((k) => DropdownMenuItem(value: k, child: Text(AppStrings.styleName(k), style: GoogleFonts.inter(fontSize: 13))))
              .toList(),
          onChanged: loading
              ? null
              : (v) {
                  if (v != null) ref.read(enhanceStyleProvider.notifier).state = v;
                },
        ),
        const SizedBox(width: 12),
        TextButton(
          onPressed: loading
              ? null
              : () async {
                  try {
                    await ref.read(reEnhanceWithStyleProvider)();
                  } catch (_) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(AppStrings.enhancedVersionError),
                          backgroundColor: Colors.orange.shade800,
                        ),
                      );
                    }
                  }
                },
          child: loading
              ? SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2, color: appGoldPrimary))
              : Text(AppStrings.reApply),
        ),
      ],
    );
  }
}

class _AttractionScoreCard extends StatelessWidget {
  final AttractionIntelligenceScore score;

  const _AttractionScoreCard({required this.score});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            _ScoreRow(AppStrings.overallAttractiveness, score.overallAttractiveness),
            _ScoreRow(AppStrings.warmth, score.warmth),
            _ScoreRow(AppStrings.confidence, score.confidence),
            _ScoreRow(AppStrings.approachability, score.approachability),
            _ScoreRow(AppStrings.premiumMatchPotential, score.premiumMatchPotential),
          ],
        ),
      ),
    );
  }
}

class _ScoreRow extends StatelessWidget {
  final String label;
  final int value;

  const _ScoreRow(this.label, this.value);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: GoogleFonts.inter(fontSize: 14, color: Colors.white70),
          ),
          Text(
            '$value%',
            style: GoogleFonts.merriweather(
              fontWeight: FontWeight.bold,
              fontSize: 16,
              color: appGoldPrimary,
            ),
          ),
        ],
      ),
    );
  }
}

class _PhotoPsychologyCard extends StatelessWidget {
  final int photoIndex;
  final File? file;
  final RankedPhoto ranked;

  const _PhotoPsychologyCard({
    required this.photoIndex,
    this.file,
    required this.ranked,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (file != null)
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.file(file!, width: 72, height: 72, fit: BoxFit.cover),
              ),
            if (file != null) const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    '${AppStrings.resultPhotoLabel} $photoIndex',
                    style: GoogleFonts.merriweather(
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                      color: Colors.white,
                    ),
                  ),
                  if (ranked.confidenceImpact.isNotEmpty)
                    Text(
                      '${AppStrings.confidenceImpact}: ${ranked.confidenceImpact}',
                      style: GoogleFonts.inter(fontSize: 13, color: Colors.white70),
                    ),
                  if (ranked.swipeProbability > 0)
                    Text(
                      '${AppStrings.swipePotential}: ${ranked.swipeProbability}%',
                      style: GoogleFonts.inter(fontSize: 13, color: Colors.white70),
                    ),
                  if (ranked.firstImpressionPrediction.isNotEmpty)
                    Text(
                      ranked.firstImpressionPrediction,
                      style: GoogleFonts.inter(fontSize: 12, color: Colors.white60),
                    ),
                  if (ranked.improvementTip.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(
                      '${AppStrings.improvement}: ${ranked.improvementTip}',
                      style: GoogleFonts.inter(
                        fontSize: 12,
                        color: Colors.white70,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _BeforeAfterSlider extends StatelessWidget {
  final File beforeFile;
  final String afterImageUrl;

  const _BeforeAfterSlider({
    required this.beforeFile,
    required this.afterImageUrl,
  });

  bool get _isLocalPath =>
      afterImageUrl.startsWith('file://') ||
      (afterImageUrl.startsWith('/') && !afterImageUrl.startsWith('http'));

  String get _localPath =>
      afterImageUrl.startsWith('file://')
          ? afterImageUrl.replaceFirst('file://', '')
          : afterImageUrl;

  Widget _buildAfterImage() {
    if (_isLocalPath) {
      return Image.file(
        File(_localPath),
        height: 180,
        fit: BoxFit.cover,
        width: double.infinity,
        errorBuilder: (_, __, ___) => const Icon(Icons.image_not_supported),
      );
    }
    return Image.network(
      afterImageUrl,
      height: 180,
      fit: BoxFit.cover,
      width: double.infinity,
      errorBuilder: (_, __, ___) => const Icon(Icons.image_not_supported),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Expanded(
          child: Column(
            children: [
              Text(AppStrings.before, style: GoogleFonts.inter(fontSize: 12, color: Colors.white70)),
              const SizedBox(height: 4),
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.file(
                  beforeFile,
                  height: 180,
                  fit: BoxFit.cover,
                  width: double.infinity,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            children: [
              Text(AppStrings.after, style: GoogleFonts.inter(fontSize: 12, color: Colors.white70)),
              const SizedBox(height: 4),
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: _buildAfterImage(),
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _EliteBioCard extends StatelessWidget {
  final String style;
  final String text;
  final String whyItWorks;

  const _EliteBioCard({
    required this.style,
    required this.text,
    required this.whyItWorks,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              style,
              style: GoogleFonts.merriweather(
                fontWeight: FontWeight.w600,
                fontSize: 14,
                color: appGoldPrimary,
              ),
            ),
            const SizedBox(height: 4),
            Text(text, style: GoogleFonts.inter(fontSize: 14, color: Colors.white70)),
            if (whyItWorks.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                '${AppStrings.whyItWorks}: $whyItWorks',
                style: GoogleFonts.inter(
                  fontSize: 12,
                  color: Colors.black54,
                  fontStyle: FontStyle.italic,
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _MatchStrategyCard extends StatelessWidget {
  final MatchStrategyReport report;

  const _MatchStrategyCard({required this.report});

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (report.bestPhotoOrder.isNotEmpty) ...[
              Text(
                AppStrings.bestPhotoOrder,
                style: GoogleFonts.merriweather(
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                report.bestPhotoOrder.map((i) => '${AppStrings.resultPhotoLabel} ${i + 1}').join(' → '),
                style: GoogleFonts.inter(fontSize: 13, color: Colors.white70),
              ),
              const SizedBox(height: 12),
            ],
            if (report.personalBrandKeywords.isNotEmpty) ...[
              Text(
                AppStrings.personalBrandKeywords,
                style: GoogleFonts.merriweather(
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                report.personalBrandKeywords.join(', '),
                style: GoogleFonts.inter(fontSize: 13, color: Colors.white70),
              ),
              const SizedBox(height: 12),
            ],
            if (report.attractiveToMaleTypes.isNotEmpty) ...[
              Text(
                AppStrings.attractiveTo,
                style: GoogleFonts.merriweather(
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                report.attractiveToMaleTypes,
                style: GoogleFonts.inter(fontSize: 13, color: Colors.white70),
              ),
              const SizedBox(height: 12),
            ],
            if (report.stylesToAvoid.isNotEmpty) ...[
              Text(
                AppStrings.stylesToAvoid,
                style: GoogleFonts.merriweather(
                  fontWeight: FontWeight.w600,
                  fontSize: 13,
                  color: Colors.white,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                report.stylesToAvoid,
                style: GoogleFonts.inter(fontSize: 13, color: Colors.white70),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// 免费用户：显示总分 + upgrade_potential 诱导 + 解锁入口
class _FreeScoreTeaser extends StatelessWidget {
  final int overallScore;
  final String upgradePotential;
  final VoidCallback onUnlock;

  const _FreeScoreTeaser({
    required this.overallScore,
    this.upgradePotential = '',
    required this.onUnlock,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  AppStrings.yourAttractionScore,
                  style: GoogleFonts.inter(
                    fontSize: 15,
                    fontWeight: FontWeight.w600,
                    color: Colors.white70,
                  ),
                ),
                Text(
                  '$overallScore%',
                  style: GoogleFonts.merriweather(
                    fontWeight: FontWeight.bold,
                    fontSize: 22,
                    color: appGoldPrimary,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            if (upgradePotential.isNotEmpty)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Text(
                  upgradePotential,
                  style: GoogleFonts.inter(
                    fontSize: 13,
                    color: appGoldPrimary,
                    fontWeight: FontWeight.w500,
                  ),
                ),
              ),
            Text(
              AppStrings.unlockScoreHint,
              style: GoogleFonts.inter(fontSize: 13, color: Colors.white60),
            ),
            const SizedBox(height: 12),
            TextButton.icon(
              onPressed: onUnlock,
              icon: const Icon(Icons.lock_open, size: 18),
              label: Text(AppStrings.unlockScoreCta),
            ),
          ],
        ),
      ),
    );
  }
}

/// 免费用户：显示一张图 + API 返回的简要 reason + 解锁
class _FreePsychologyTeaser extends StatelessWidget {
  final AnalysisResultModel result;
  final List<PhotoModel> photos;
  final VoidCallback onUnlock;

  const _FreePsychologyTeaser({
    required this.result,
    required this.photos,
    required this.onUnlock,
  });

  @override
  Widget build(BuildContext context) {
    final first = result.rankedPhotos.isNotEmpty ? result.rankedPhotos.first : null;
    File? file;
    if (first != null && first.index < photos.length) {
      file = photos[first.index].file;
    }
    final reason = first?.reason ?? '';

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (file != null)
              ClipRRect(
                borderRadius: BorderRadius.circular(8),
                child: Image.file(file, height: 120, width: double.infinity, fit: BoxFit.cover),
              ),
            if (file != null) const SizedBox(height: 12),
            if (reason.isNotEmpty)
              Text(
                reason,
                style: GoogleFonts.inter(fontSize: 13, color: Colors.black87),
              ),
            const SizedBox(height: 12),
            TextButton.icon(
              onPressed: onUnlock,
              icon: const Icon(Icons.lock_open, size: 18),
              label: Text(AppStrings.unlockPsychologyCta),
            ),
          ],
        ),
      ),
    );
  }
}

class _LockedPlaceholder extends StatelessWidget {
  final String hint;
  final VoidCallback onUnlock;

  const _LockedPlaceholder({required this.hint, required this.onUnlock});

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onUnlock,
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          color: appSurfaceCard,
          borderRadius: BorderRadius.circular(20),
          border: Border.all(color: Colors.white12),
        ),
        child: Row(
          children: [
            Icon(Icons.lock_outline, size: 32, color: appGoldPrimary),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                hint,
                style: GoogleFonts.inter(color: Colors.white70, fontSize: 14),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
