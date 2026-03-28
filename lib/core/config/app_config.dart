class AppConfig {
  AppConfig._();

  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://steam-game-api-r7vmg7elga-as.a.run.app',
  );

  static const String steamCallbackScheme = String.fromEnvironment(
    'STEAM_CALLBACK_SCHEME',
    defaultValue: 'myapp',
  );
}

