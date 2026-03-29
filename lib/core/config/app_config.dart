class AppConfig {
  AppConfig._();

  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://steam-game-api-803425642695.asia-southeast1.run.app',
  );

  static const String steamCallbackScheme = String.fromEnvironment(
    'STEAM_CALLBACK_SCHEME',
    defaultValue: 'myapp',
  );
}

