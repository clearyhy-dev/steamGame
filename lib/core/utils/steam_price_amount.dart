/// Normalizes raw values from Steam [price_overview] (minor units) to display amounts.
/// Server should return pre-normalized values; this is a client safeguard for cached/old payloads.
double steamMinorUnitsToDisplayAmount(num raw, String currency) {
  final c = currency.trim().toUpperCase();
  if (c == 'JPY' || c == 'KRW') {
    return raw.toDouble();
  }
  return raw.toDouble() / 100.0;
}

/// Third-party deal rows may store cents or major units; prefer [currency] when present.
double? normalizeDealPriceAmount(num? raw, String currency) {
  if (raw == null) return null;
  final v = raw.toDouble();
  final c = currency.trim().toUpperCase();
  if (c == 'JPY' || c == 'KRW') {
    return v > 50000 ? v / 100.0 : v;
  }
  if (v > 1000) return v / 100.0;
  return v;
}
