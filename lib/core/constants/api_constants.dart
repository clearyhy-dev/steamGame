import '../app_remote_config.dart';

/// 后端 API 基础地址（Cloud Run `steam-game-api`）。
/// 本地调试可覆盖：`--dart-define=API_BASE_URL=http://10.0.2.2:8080`（Android 模拟器连本机 server）。
class ApiConstants {
  static const String baseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://steam-game-api-r7vmg7elga-as.a.run.app',
  );

  /// Overridable via `/api/config` after [AppRemoteConfig.loadFromBackend].
  static Duration get connectTimeout => Duration(seconds: AppRemoteConfig.instance.connectTimeoutSec);
  static Duration get receiveTimeout => Duration(seconds: AppRemoteConfig.instance.receiveTimeoutSec);

  static const String errorDetailKey = 'detail';
}

