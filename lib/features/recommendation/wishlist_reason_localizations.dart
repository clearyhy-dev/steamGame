import '../../l10n/app_localizations.dart';

String localizedWishlistReason(AppLocalizations l10n, String code) {
  switch (code) {
    case 'deep_discount':
      return l10n.get('reason_wl_deep_discount');
    case 'solid_discount':
      return l10n.get('reason_wl_solid_discount');
    case 'shallow_discount':
      return l10n.get('reason_wl_shallow_discount');
    case 'could_go_lower':
      return l10n.get('reason_wl_could_go_lower');
    case 'fair_price':
      return l10n.get('reason_wl_fair_price');
    case 'low_priority':
      return l10n.get('reason_wl_low_priority');
    case 'price_unavailable':
      return l10n.get('reason_wl_price_unavailable');
    case 'check_steam_store':
      return l10n.get('reason_wl_check_steam_store');
    default:
      if (code.isEmpty) return '';
      return l10n.get('reason_wl_generic');
  }
}
