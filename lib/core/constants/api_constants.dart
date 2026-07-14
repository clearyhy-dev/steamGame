import '../app_remote_config.dart';

/// 后端 API 基础地址（Vultr 业务 API）。
/// 本地调试可覆盖：`--dart-define=API_BASE_URL=http://10.0.2.2:8080`
class ApiConstants {
  /// Vultr 业务 API（折扣、收藏、视频、配置等）
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://139.180.199.42:8080',
  );

  /// Steam OpenID（GCP Cloud Run；业务 API 可走 Vultr）
  static const String authBaseUrl = String.fromEnvironment(
    'AUTH_BASE_URL',
    defaultValue: 'https://steam-game-api-r7vmg7elga-as.a.run.app',
  );

  static Duration get connectTimeout =>
      Duration(seconds: AppRemoteConfig.instance.connectTimeoutSec);
  static Duration get receiveTimeout =>
      Duration(seconds: AppRemoteConfig.instance.receiveTimeoutSec);

  static const String errorDetailKey = 'detail';
}
