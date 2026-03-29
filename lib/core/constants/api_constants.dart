/// 后端 API 基础地址（Cloud Run `steam-game-api`）。
/// 本地调试可覆盖：`--dart-define=API_BASE_URL=http://10.0.2.2:8080`（Android 模拟器连本机 server）。
class ApiConstants {
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://steam-game-api-803425642695.asia-southeast1.run.app',
  );

  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 90);

  static const String errorDetailKey = 'detail';
}

