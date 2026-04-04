import 'package:flutter/material.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';

import '../core/ad_config.dart';
import '../core/services/analytics_service.dart';
import '../core/theme/colors.dart';

/// Explore 信息流 Native：卡片外观 + 右上角「Ad」标识；失败则不占位。
class ExploreNativeAdCard extends StatefulWidget {
  const ExploreNativeAdCard({
    super.key,
    required this.placement,
    this.enabled = true,
    this.onLoadFailed,
  });

  final String placement;
  final bool enabled;
  final VoidCallback? onLoadFailed;

  @override
  State<ExploreNativeAdCard> createState() => _ExploreNativeAdCardState();
}

class _ExploreNativeAdCardState extends State<ExploreNativeAdCard> {
  NativeAd? _nativeAd;
  bool _loaded = false;
  bool _failed = false;
  bool _started = false;

  static const double _cardHeight = 300;

  @override
  void initState() {
    super.initState();
    if (!widget.enabled || !AdConfig.adsEnabledByPolicy) return;
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _startLoad();
    });
  }

  void _startLoad() {
    if (_started || _failed || _loaded) return;
    _started = true;
    final unitId = AdConfig.exploreNativeAdUnitId;
    try {
      final ad = NativeAd(
        adUnitId: unitId,
        listener: NativeAdListener(
          onAdLoaded: (ad) {
            if (!mounted) return;
            setState(() {
              _loaded = true;
              _nativeAd = ad as NativeAd;
            });
          },
          onAdFailedToLoad: (ad, err) {
            debugPrint('ExploreNativeAdCard failed [${widget.placement}]: $err');
            AnalyticsService.instance.logAdLoadFailed(
              adUnitId: unitId,
              adFormat: 'native',
              placement: widget.placement,
              errorCode: err.code.toString(),
            );
            ad.dispose();
            if (mounted) {
              setState(() => _failed = true);
              widget.onLoadFailed?.call();
            }
          },
          onAdImpression: (ad) {
            AnalyticsService.instance.logAdImpression(
              adUnitId: unitId,
              adFormat: 'native',
              placement: widget.placement,
            );
          },
          onAdClicked: (ad) {
            AnalyticsService.instance.logAdClick(
              adUnitId: unitId,
              adFormat: 'native',
              placement: widget.placement,
            );
          },
        ),
        request: const AdRequest(),
        nativeTemplateStyle: NativeTemplateStyle(
          templateType: TemplateType.medium,
          mainBackgroundColor: AppColors.cardDark,
          cornerRadius: 12,
        ),
      );
      ad.load();
    } catch (e, st) {
      debugPrint('ExploreNativeAdCard _startLoad: $e\n$st');
      if (mounted) {
        setState(() => _failed = true);
        widget.onLoadFailed?.call();
      }
    }
  }

  @override
  void dispose() {
    _nativeAd?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (!widget.enabled || !AdConfig.adsEnabledByPolicy) {
      return const SizedBox.shrink();
    }
    if (_failed) return const SizedBox.shrink();
    if (!_loaded || _nativeAd == null) {
      return const SizedBox(height: 0);
    }
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Material(
        color: AppColors.cardDark,
        borderRadius: BorderRadius.circular(14),
        child: Stack(
          clipBehavior: Clip.none,
          children: [
            Padding(
              padding: const EdgeInsets.only(top: 8, right: 8, left: 8, bottom: 8),
              child: SizedBox(
                height: _cardHeight,
                width: double.infinity,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(10),
                  child: AdWidget(ad: _nativeAd!),
                ),
              ),
            ),
            Positioned(
              top: 12,
              right: 12,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: Colors.black.withValues(alpha: 0.55),
                  borderRadius: BorderRadius.circular(6),
                  border: Border.all(color: Colors.white24),
                ),
                child: const Text(
                  'Ad',
                  style: TextStyle(
                    color: Colors.white70,
                    fontSize: 11,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
