class ApiConstants {
  ApiConstants._();

  /// API 基础地址
  /// - 生产: Cloud Run 默认
  /// - 本地调试: 用 --dart-define=API_BASE_URL=http://10.0.2.2:8080 (Android 模拟器)
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://matchmuse-api-882947662924.us-central1.run.app',
  );

  /// 请求超时。背景替换含抠图+合成，放宽到 180 秒
  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 90);
  static const Duration backgroundReplaceTimeout = Duration(seconds: 180);

  static const String analyzePath = '/analyze';
  static const String enhancePath = '/enhance';
  static const String verifyPurchasePath = '/verify-purchase';
  static const String backgroundsPath = '/backgrounds';
  static const String backgroundReplacePath = '/background-replace';
  static const String configPath = '/config';

  /// FastAPI HTTPException 返回的 detail 字段
  static const String errorDetailKey = 'detail';
}
