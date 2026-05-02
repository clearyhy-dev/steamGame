import 'price_region_resolver.dart';

bool dealMatchesPriceRegion(
  Map<String, dynamic> row,
  PriceRegionContext region,
) {
  final cc =
      (row['countryCode'] ?? row['region'] ?? '').toString().trim().toUpperCase();
  final cur = (row['currency'] ?? '').toString().trim().toUpperCase();
  final hasCc = cc.isNotEmpty;
  final hasCur = cur.isNotEmpty;
  if (!hasCc && !hasCur) return false;
  if (hasCc && cc != region.country) return false;
  if (hasCur && cur != region.currency) return false;
  return true;
}
