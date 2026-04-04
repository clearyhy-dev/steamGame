import 'package:flutter/material.dart';

import '../../../core/theme/colors.dart';
import '../../../l10n/app_localizations.dart';

/// 首页 Steam：已绑定为三列等宽框（总时长 / 好友 / 在线），点击进入 Steam 全部信息。
class HomeSteamSnapshotSection extends StatelessWidget {
  const HomeSteamSnapshotSection({
    super.key,
    required this.loading,
    required this.steamLinked,
    this.summary,
    this.friendCount,
    this.friendsOnline,
    this.onOpenFull,
  });

  final bool loading;
  final bool steamLinked;
  final Map<String, dynamic>? summary;
  final int? friendCount;
  final int? friendsOnline;
  final VoidCallback? onOpenFull;

  bool get _canShowLinked =>
      steamLinked && summary != null && summary!['steamLinked'] == true;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (loading)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 8),
            child: Center(
              child: SizedBox(
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2),
              ),
            ),
          )
        else if (!_canShowLinked)
          _hintStrip(l10n.get('home_snapshot_placeholder'))
        else
          _threeBoxes(context, l10n, summary!),
      ],
    );
  }

  Widget _hintStrip(String text) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: AppColors.cardDark.withValues(alpha: 0.55),
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.white.withValues(alpha: 0.06)),
      ),
      child: Text(
        text,
        style: const TextStyle(fontSize: 12, color: AppColors.textSecondary, height: 1.3),
      ),
    );
  }

  String _hoursLabel(AppLocalizations l10n, int? minutes) {
    if (minutes == null) return '—';
    if (minutes <= 0) return l10n.get('steam_hours_zero');
    final h = minutes / 60.0;
    final v = h >= 100 ? h.round().toString() : h.toStringAsFixed(1);
    return l10n.get('steam_hours_value').replaceAll('{v}', v);
  }

  String _intOrDash(int? n) {
    if (n == null) return '—';
    return '$n';
  }

  Widget _threeBoxes(BuildContext context, AppLocalizations l10n, Map<String, dynamic> s) {
    final totalMin = s['totalPlaytimeMinutes'] is num ? (s['totalPlaytimeMinutes'] as num).round() : null;

    final row = Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: _statBox(
            value: _hoursLabel(l10n, totalMin),
            caption: l10n.get('home_steam_metric_playtime'),
          ),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: _statBox(
            value: _intOrDash(friendCount),
            caption: l10n.get('home_steam_metric_friends'),
          ),
        ),
        const SizedBox(width: 6),
        Expanded(
          child: _statBox(
            value: _intOrDash(friendsOnline),
            caption: l10n.get('home_steam_metric_online'),
          ),
        ),
      ],
    );

    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      mainAxisSize: MainAxisSize.min,
      children: [
        row,
        const SizedBox(height: 4),
        Row(
          mainAxisAlignment: MainAxisAlignment.end,
          children: [
            Text(
              l10n.get('home_steam_tap_detail'),
              style: TextStyle(fontSize: 10, color: AppColors.itadOrange.withValues(alpha: 0.95)),
            ),
            Icon(Icons.chevron_right_rounded, size: 14, color: AppColors.itadOrange.withValues(alpha: 0.95)),
          ],
        ),
      ],
    );

    if (onOpenFull == null) {
      return Padding(
        padding: const EdgeInsets.only(top: 2),
        child: content,
      );
    }

    return Padding(
      padding: const EdgeInsets.only(top: 2),
      child: Material(
        color: Colors.transparent,
        child: InkWell(
          onTap: onOpenFull,
          borderRadius: BorderRadius.circular(12),
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: 2, vertical: 2),
            child: content,
          ),
        ),
      ),
    );
  }

  Widget _statBox({required String value, required String caption}) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
      decoration: BoxDecoration(
        color: AppColors.cardDark.withValues(alpha: 0.92),
        borderRadius: BorderRadius.circular(10),
        border: Border.all(color: Colors.white.withValues(alpha: 0.08)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.center,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            value,
            textAlign: TextAlign.center,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: const TextStyle(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: AppColors.textPrimary,
              height: 1.1,
            ),
          ),
          const SizedBox(height: 3),
          Text(
            caption,
            textAlign: TextAlign.center,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 10,
              height: 1.12,
              color: AppColors.textSecondary.withValues(alpha: 0.95),
            ),
          ),
        ],
      ),
    );
  }
}
