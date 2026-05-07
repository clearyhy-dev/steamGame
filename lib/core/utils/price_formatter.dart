import '../../models/game_model.dart';
import '../../l10n/app_localizations.dart';
import '../app_country_resolver.dart';
import '../country_catalog_service.dart';

String _configuredSymbolForCurrency(String currencyCode) {
  final code = currencyCode.trim().toUpperCase();
  if (code.isEmpty) return '';
  try {
    final ctx = AppCountryResolver.resolveSync();
    final country = ctx.countryCode.trim().toUpperCase();
    if (country.isEmpty) return '';
    final catalog = CountryCatalogService.instance;
    final countryCurrency = catalog.defaultCurrencyFor(country)?.trim().toUpperCase();
    if (countryCurrency == code) {
      return catalog.currencySymbolFor(country)?.trim() ?? '';
    }
  } catch (_) {
    // Keep formatter resilient during cold start.
  }
  return '';
}

String formatRegionalPrice({
  required num? amount,
  required String currency,
}) {
  if (amount == null) return '-';
  final code = currency.trim().toUpperCase();
  final configured = _configuredSymbolForCurrency(code);
  if (configured.isNotEmpty) {
    if (code == 'JPY' || code == 'KRW' || code == 'VND') {
      return '$configured${amount.round()}';
    }
    return '$configured${amount.toStringAsFixed(2)}';
  }
  switch (code) {
    case 'USD':
      return '\$${amount.toStringAsFixed(2)}';
    case 'EUR':
      return '€${amount.toStringAsFixed(2)}';
    case 'JPY':
      return '¥${amount.round()}';
    case 'CNY':
      return '¥${amount.toStringAsFixed(2)}';
    case 'INR':
      return '₹${amount.toStringAsFixed(2)}';
    case 'BRL':
      return 'R\$${amount.toStringAsFixed(2)}';
    case 'PLN':
      return 'zł${amount.toStringAsFixed(2)}';
    case '':
      return '\$${amount.toStringAsFixed(2)}';
    default:
      return '$code ${amount.toStringAsFixed(2)}';
  }
}

bool _catalogDefaultCurrencyIsUsd() {
  try {
    final ctx = AppCountryResolver.resolveSync();
    final country = ctx.countryCode.trim().toUpperCase();
    if (country.isEmpty) return true;
    final cur = CountryCatalogService.instance
        .defaultCurrencyFor(country)
        ?.trim()
        .toUpperCase();
    return cur == 'USD';
  } catch (_) {
    return true;
  }
}

String _localeLivePriceUnavailable() {
  final lang = AppCountryResolver.resolveSync().uiLanguageCode;
  return AppLocalizations.getStringForLocale(lang, 'reason_wl_price_unavailable');
}

String _localeGlobalUsdReferenceLabel() {
  final lang = AppCountryResolver.resolveSync().uiLanguageCode;
  return AppLocalizations.getStringForLocale(lang, 'price_global_reference_usd');
}

/// 列表/卡片：Steam formatted → ITAD 区域回填 → 全球池（明示 USD 参考）
String formatGameListSalePrice(GameModel game, String regionCurrency) {
  final fmt = game.steamFinalFormatted?.trim();
  if (fmt != null && fmt.isNotEmpty) return fmt;
  final listFb = game.steamListFallbackFormatted?.trim();
  if (listFb != null && listFb.isNotEmpty) return listFb;
  if (game.priceIsGlobalUsd) {
    if (game.price > 0) {
      if (_catalogDefaultCurrencyIsUsd()) {
        return '\$${game.price.toStringAsFixed(2)}';
      }
      return '\$${game.price.toStringAsFixed(2)} · ${_localeGlobalUsdReferenceLabel()}';
    }
    return _localeLivePriceUnavailable();
  }
  return formatRegionalPrice(amount: game.price, currency: regionCurrency);
}

String formatGameListOriginalPrice(GameModel game, String regionCurrency) {
  final fmt = game.steamInitialFormatted?.trim();
  if (fmt != null && fmt.isNotEmpty) return fmt;
  final listFb = game.steamListFallbackInitialFormatted?.trim();
  if (listFb != null && listFb.isNotEmpty) return listFb;
  if (game.priceIsGlobalUsd) {
    if (game.originalPrice > 0) {
      if (_catalogDefaultCurrencyIsUsd()) {
        return '\$${game.originalPrice.toStringAsFixed(2)}';
      }
      return '\$${game.originalPrice.toStringAsFixed(2)} · ${_localeGlobalUsdReferenceLabel()}';
    }
    return '';
  }
  return formatRegionalPrice(amount: game.originalPrice, currency: regionCurrency);
}

