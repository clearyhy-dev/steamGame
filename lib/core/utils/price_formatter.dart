String formatRegionalPrice({
  required num? amount,
  required String currency,
}) {
  if (amount == null) return '-';
  final code = currency.trim().toUpperCase();
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

