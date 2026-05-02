import 'price_formatter.dart';
import 'price_region_resolver.dart';

/// 价格、折扣等展示格式化
String formatPrice(double price) {
  if (price <= 0) return 'Free';
  final region = PriceRegionResolver.resolveSync();
  return formatRegionalPrice(amount: price, currency: region.currency);
}

String formatDiscount(int percent) {
  if (percent <= 0) return '';
  return '-$percent%';
}

String formatPriceRange(double original, double sale) {
  if (original <= 0) return formatPrice(sale);
  return '${formatPrice(original)} → ${formatPrice(sale)}';
}
