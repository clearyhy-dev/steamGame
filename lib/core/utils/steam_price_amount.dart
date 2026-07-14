const _intLikeCurrencies = {'JPY', 'KRW', 'VND', 'CLP', 'IDR', 'HUF', 'ISK', 'UGX'};

/// Legacy market rows stored JPY in cent-like scale (116600 vs ¥1166). Do not apply to VND/IDR/KRW.
double? _legacyCentScaledJpy(double v) {
  if (v <= 5000 || v > 999999 || v % 100 != 0) return null;
  final d = v / 100.0;
  if (d >= 500 && d <= 50000) return d;
  return null;
}

/// Normalizes raw values from Steam [price_overview] (minor units) to display amounts.
double steamMinorUnitsToDisplayAmount(num raw, String currency) {
  final c = currency.trim().toUpperCase();
  final v = raw.toDouble();
  if (_intLikeCurrencies.contains(c)) {
    if (c == 'JPY') {
      return _legacyCentScaledJpy(v) ?? v;
    }
    return v;
  }
  return v / 100.0;
}

/// Third-party deal rows may store cents or major units; prefer [currency] when present.
double? normalizeDealPriceAmount(num? raw, String currency) {
  if (raw == null) return null;
  final v = raw.toDouble();
  final c = currency.trim().toUpperCase();
  if (_intLikeCurrencies.contains(c)) {
    if (c == 'JPY') {
      return _legacyCentScaledJpy(v) ?? v;
    }
    return v;
  }
  if (v > 1000) return v / 100.0;
  return v;
}

bool isIntLikeCurrency(String currency) =>
    _intLikeCurrencies.contains(currency.trim().toUpperCase());
