import '../../l10n/app_localizations.dart';

/// Maps backend reason codes to UI strings.
String localizedReason(AppLocalizations l10n, String code) {
  switch (code) {
    case 'because_recent':
      return l10n.get('reason_because_recent');
    case 'similar_taste':
      return l10n.get('reason_similar_taste');
    case 'great_discount':
      return l10n.get('reason_great_discount');
    case 'high_rated':
      return l10n.get('reason_high_rated');
    case 'popular_now':
      return l10n.get('reason_popular_now');
    case 'fresh_deal':
      return l10n.get('reason_fresh_deal');
    default:
      return l10n.get('reason_generic');
  }
}
