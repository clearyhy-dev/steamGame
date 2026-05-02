import '../../models/game_model.dart';
import '../country_catalog_service.dart';
import 'price_region_resolver.dart';

String _configuredSymbolForCurrency(String currencyCode) {
  final code = currencyCode.trim().toUpperCase();
  if (code.isEmpty) return '';
  try {
    final ctx = PriceRegionResolver.resolveSync();
    final country = ctx.country.trim().toUpperCase();
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

/// 列表/卡片：优先后端 Steam formatted；否则第三方聚合（CheapShark 等）按 **Global USD** 展示，不套用地区货币。
String formatGameListSalePrice(GameModel game, String regionCurrency) {
  final fmt = game.steamFinalFormatted?.trim();
  if (fmt != null && fmt.isNotEmpty) return fmt;
  if (game.priceIsGlobalUsd) {
    return '\$${game.price.toStringAsFixed(2)}';
  }
  return formatRegionalPrice(amount: game.price, currency: regionCurrency);
}

String formatGameListOriginalPrice(GameModel game, String regionCurrency) {
  final fmt = game.steamInitialFormatted?.trim();
  if (fmt != null && fmt.isNotEmpty) return fmt;
  if (game.priceIsGlobalUsd) {
    return '\$${game.originalPrice.toStringAsFixed(2)}';
  }
  return formatRegionalPrice(amount: game.originalPrice, currency: regionCurrency);
}

