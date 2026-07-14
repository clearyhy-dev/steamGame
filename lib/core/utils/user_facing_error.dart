/// Maps exceptions to user-safe messages (no URIs / stack traces).
String userFacingError(Object? error, {String fallback = 'Something went wrong'}) {
  final raw = error?.toString() ?? '';
  if (raw.isEmpty) return fallback;
  final lower = raw.toLowerCase();
  if (lower.contains('clientexception') ||
      lower.contains('connection closed') ||
      lower.contains('connection refused') ||
      lower.contains('failed host lookup') ||
      lower.contains('network is unreachable') ||
      lower.contains('socketexception') ||
      lower.contains('timed out') ||
      lower.contains('timeout')) {
    return fallback;
  }
  if (lower.contains('401') || lower.contains('unauthorized')) {
    return 'Please sign in and try again';
  }
  if (lower.contains('404') || lower.contains('not found')) {
    return 'Content not found';
  }
  return fallback;
}
