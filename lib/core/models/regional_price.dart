/// Describes one priced offer for UI layering (Steam vs keyshops).
class RegionalPrice {
  const RegionalPrice({
    this.regularPrice,
    this.salePrice,
    required this.currency,
    required this.country,
    this.discountPercent,
    required this.source,
    this.fallbackUsed = false,
    required this.isRegional,
  });

  final num? regularPrice;
  final num? salePrice;
  final String currency;
  final String country;
  final int? discountPercent;
  final String source;
  final bool fallbackUsed;
  final bool isRegional;
}
