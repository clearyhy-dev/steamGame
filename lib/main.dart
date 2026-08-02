import 'dart:async';
import 'dart:io' show Platform;
import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:google_mobile_ads/google_mobile_ads.dart';
import 'package:workmanager/workmanager.dart';
import 'package:app_links/app_links.dart';
import 'package:permission_handler/permission_handler.dart';
import 'app.dart';
import 'core/steam_auth_events.dart';
import 'core/fcm_background.dart';
import 'core/fcm_service.dart';
import 'core/background_task.dart';
import 'core/constants.dart';
import 'core/app_remote_config.dart';
import 'core/constants/api_constants.dart';
import 'core/app_country_resolver.dart';
import 'core/app_country_steam_sync.dart';
import 'core/country_catalog_service.dart';
import 'core/services/billing_service.dart';
import 'core/services/subscription_service.dart';
import 'core/storage_service.dart';
import 'data/services/cache_service.dart';
import 'core/notification_service.dart';
import 'core/schedule_config.dart';
import 'core/app_user_sync.dart';
import 'core/services/auth_service.dart';
import 'core/session/session_store.dart';
import 'features/splash/splash_bootstrap.dart';
import 'services/steam_backend_service.dart';
import 'l10n/app_localizations.dart';

/// 后端 `deepLink()` 生成的是 `myapp://auth/steam/success`（`auth` 为 [Uri.host]，路径为 `/steam/success`），
/// 此时 [Uri.pathSegments] 为 `steam,success`，不能按 `/auth/steam/...` 三段路径解析。
bool _steamDeepLinkIsSuccess(Uri uri) {
  final scheme = AppRemoteConfig.instance.deeplinkScheme;
  final hostOk = AppRemoteConfig.instance.deeplinkSuccessHost;
  if (uri.scheme != scheme) return false;
  if (uri.host == hostOk &&
      uri.pathSegments.length >= 2 &&
      uri.pathSegments[0] == 'steam' &&
      uri.pathSegments[1] == 'success') {
    return true;
  }
  if (uri.pathSegments.length >= 3 &&
      uri.pathSegments[0] == 'auth' &&
      uri.pathSegments[1] == 'steam' &&
      uri.pathSegments[2] == 'success') {
    return true;
  }
  return false;
}

bool _steamDeepLinkIsFail(Uri uri) {
  final scheme = AppRemoteConfig.instance.deeplinkScheme;
  final hostFail = AppRemoteConfig.instance.deeplinkFailHost;
  if (uri.scheme != scheme) return false;
  if (uri.host == hostFail &&
      uri.pathSegments.length >= 2 &&
      uri.pathSegments[0] == 'steam' &&
      uri.pathSegments[1] == 'fail') {
    return true;
  }
  if (uri.pathSegments.length >= 3 &&
      uri.pathSegments[0] == 'auth' &&
      uri.pathSegments[1] == 'steam' &&
      uri.pathSegments[2] == 'fail') {
    return true;
  }
  return false;
}

Future<void> _handleSteamAuthDeepLink(Uri? uri) async {
  if (uri == null) return;

  if (_steamDeepLinkIsSuccess(uri)) {
    final token = uri.queryParameters['token'];
    if (token == null || token.isEmpty) return;
    try {
      await StorageService.instance.setSteamBackendToken(token);
      final backend = SteamBackendService();
      final me = await backend.getMe(token);
      final trial = me['trial'];
      if (trial is Map) {
        final endsAtRaw = trial['endsAt']?.toString() ?? '';
        if (endsAtRaw.isNotEmpty) {
          try {
            await StorageService.instance
                .setBackendTrialUntil(DateTime.parse(endsAtRaw));
          } catch (_) {}
        }
      }
      final profile = await backend.getSteamProfile(token);

      await StorageService.instance.setSteamProfileCache(
        steamId: profile['steamId']?.toString() ?? '',
        personaName: profile['personaName']?.toString() ?? '',
        avatar: profile['avatar']?.toString() ?? '',
        profileUrl: profile['profileUrl']?.toString() ?? '',
      );

      await AppCountrySteamSync.applyFromSteamOverviewIfEligible(token);
      await AppUserSync.afterAuthLogin();

      SteamAuthEvents.instance.emitSuccess(
        SteamAuthSuccessPayload(
          token: token,
          steamId: profile['steamId']?.toString() ?? '',
          personaName: profile['personaName']?.toString() ?? '',
          avatar: profile['avatar']?.toString() ?? '',
          profileUrl: profile['profileUrl']?.toString() ?? '',
        ),
      );
      var steamSnackShown = false;
      void showSuccessBar() {
        if (steamSnackShown) return;
        final ctx = navigatorKey.currentContext;
        if (ctx == null) return;
        steamSnackShown = true;
        final l10n = AppLocalizations.of(ctx);
        ScaffoldMessenger.of(ctx).showSnackBar(
          SnackBar(content: Text(l10n.get('steam_linked_success'))),
        );
      }

      showSuccessBar();
      WidgetsBinding.instance.addPostFrameCallback((_) => showSuccessBar());
      // runApp 前尚无 Navigator 时，仅靠上面两次；再兜底一次避免漏提示
      Future<void>.delayed(const Duration(milliseconds: 1500), showSuccessBar);
    } catch (e) {
      debugPrint('DeepLink steam success handle error: $e');
    }
    return;
  }

  if (_steamDeepLinkIsFail(uri)) {
    final reason = uri.queryParameters['reason'] ?? 'Unknown error';
    try {
      var failSnackShown = false;
      void showFailBar() {
        if (failSnackShown) return;
        final ctx = navigatorKey.currentContext;
        if (ctx == null) return;
        failSnackShown = true;
        final l10n = AppLocalizations.of(ctx);
        ScaffoldMessenger.of(ctx).showSnackBar(
          SnackBar(
              content: Text('${l10n.get('steam_login_start_failed')}$reason'),
              duration: const Duration(seconds: 5)),
        );
      }

      showFailBar();
      WidgetsBinding.instance.addPostFrameCallback((_) => showFailBar());
      Future<void>.delayed(const Duration(milliseconds: 1500), showFailBar);
    } catch (_) {}
  }
}

Future<void> _syncTrialFromBackendIfLoggedIn() async {
  try {
    final token = await StorageService.instance.getSteamBackendToken();
    if (token == null || token.isEmpty) return;
    // 服务端/手动选区已在 bootstrap 对齐；此处仅补 Steam 初检（manualPick 时会跳过）
    await AppCountrySteamSync.applyFromSteamOverviewIfEligible(token);
    await AppUserSync.applyServerCountryIfPresent(notifyUi: true);
    final backend = SteamBackendService();
    final me = await backend.getMe(token);
    final trial = me['trial'];
    if (trial is Map) {
      final endsAtRaw = trial['endsAt']?.toString() ?? '';
      if (endsAtRaw.isNotEmpty) {
        try {
          await StorageService.instance
              .setBackendTrialUntil(DateTime.parse(endsAtRaw));
        } catch (_) {}
      }
    }
  } catch (_) {}
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  try {
    await Firebase.initializeApp();
  } catch (e, stack) {
    debugPrint('Firebase.init: $e\n$stack');
  }

  try {
    FirebaseMessaging.onBackgroundMessage(firebaseMessagingBackgroundHandler);
  } catch (e, stack) {
    debugPrint('FCM.onBackgroundMessage: $e\n$stack');
  }

  // 全局捕获 Flutter 框架错误与异步未捕获异常，避免启动白屏/闪退无日志
  FlutterError.onError = (FlutterErrorDetails details) {
    debugPrint('FlutterError: ${details.exception}\n${details.stack}');
    if (kDebugMode) {
      FlutterError.presentError(details);
    }
  };
  // 构建阶段异常时显示简单提示而非红屏，便于真机排查
  ErrorWidget.builder = (FlutterErrorDetails details) {
    debugPrint('ErrorWidget: ${details.exception}\n${details.stack}');
    return Material(
      color: const Color(0xFF0B141B),
      child: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.warning_amber_rounded,
                  size: 48, color: Colors.orange),
              const SizedBox(height: 16),
              Text(
                'Something went wrong.',
                textAlign: TextAlign.center,
                style: TextStyle(color: Colors.grey[300], fontSize: 16),
              ),
              if (kDebugMode) ...[
                const SizedBox(height: 12),
                Text(details.exceptionAsString(),
                    style: TextStyle(color: Colors.grey[500], fontSize: 12),
                    maxLines: 3,
                    overflow: TextOverflow.ellipsis),
              ],
            ],
          ),
        ),
      ),
    );
  };
  runZonedGuarded(() {
    // 立刻进入带文案的启动页；重初始化在首帧后并行完成，缩短卡住几秒的感觉。
    runApp(SplashBootstrap(bootstrap: _bootstrapForFirstFrame));
  }, (error, stack) {
    debugPrint('Uncaught error: $error\n$stack');
  });
}

/// 首屏前关键路径：存储 + 本地登录身份（无网络）必须完成；网络项可超时。
Future<void> _bootstrapForFirstFrame() async {
  // —— 关键：不可被 splash 超时截断语义上「跳过」——
  try {
    await StorageService.instance.init();
  } catch (e) {
    debugPrint('StorageService.init: $e');
  }
  try {
    await SessionStore.instance.init(
      prefs: StorageService.instance.isInitialized
          ? StorageService.instance.prefs
          : null,
    );
  } catch (e) {
    debugPrint('SessionStore.init: $e');
  }
  try {
    // 仅本地：prefs/Hive 回填身份，保证进主页时已登录态可见
    await AuthService().restoreLocalSession();
  } catch (e) {
    debugPrint('AuthService.restoreLocalSession: $e');
  }

  await Future.wait<void>([
    () async {
      try {
        await CacheService.init();
      } catch (e) {
        debugPrint('CacheService.init: $e');
      }
    }(),
    () async {
      try {
        await AppRemoteConfig.instance.loadFromBackend(ApiConstants.baseUrl);
      } catch (e) {
        debugPrint('AppRemoteConfig.load: $e');
      }
    }(),
    () async {
      try {
        await CountryCatalogService.instance.load(ApiConstants.baseUrl);
      } catch (e) {
        debugPrint('CountryCatalogService.load: $e');
      }
    }(),
  ]);

  // 网络：补 JWT / Google 静默（失败不踢本地身份）
  try {
    await AuthService().restoreSession();
  } catch (e) {
    debugPrint('AuthService.restoreSession: $e');
  }

  // 已登录：首帧前先用账号上的国家（如 FR），避免先落 US 再异步覆盖却不刷新 UI
  try {
    await AppUserSync.applyServerCountryIfPresent(notifyUi: false);
  } catch (e) {
    debugPrint('AppUserSync.applyServerCountry: $e');
  }

  try {
    await AppCountryResolver.resolveContext();
  } catch (e) {
    debugPrint('AppCountryResolver.resolveContext: $e');
  }

  try {
    final appLinks = AppLinks();
    final initialUri = await appLinks.getInitialLink();
    if (initialUri != null) {
      final ref = initialUri.queryParameters['ref'];
      if (ref != null && ref.isNotEmpty) {
        await StorageService.instance.setReferrerId(ref);
      }
      await _handleSteamAuthDeepLink(initialUri);
    }
    appLinks.uriLinkStream.listen((uri) async {
      await _handleSteamAuthDeepLink(uri);
    });
  } catch (e) {
    debugPrint('AppLinks.getInitialLink: $e');
  }

  // 非关键：广告 / 内购 / 通知 / FCM / 后台任务 → 不挡进首页
  unawaited(_initDeferredServices());
}

Future<void> _initDeferredServices() async {
  try {
    await MobileAds.instance.initialize();
  } catch (e) {
    debugPrint('MobileAds.init: $e');
  }

  try {
    await BillingService().init();
    SubscriptionService().restorePurchases().catchError((_) {});
  } catch (e) {
    debugPrint('BillingService.init: $e');
  }

  unawaited(_syncTrialFromBackendIfLoggedIn());

  try {
    await NotificationService.instance.init();
  } catch (e) {
    debugPrint('NotificationService.init: $e');
  }

  try {
    await FcmService.instance.init();
  } catch (e) {
    debugPrint('FcmService.init: $e');
  }

  try {
    if (Platform.isAndroid) {
      final status = await Permission.notification.status;
      if (status.isDenied) await Permission.notification.request();
    }
  } catch (e) {
    debugPrint('NotificationPermission: $e');
  }

  try {
    await Workmanager().initialize(callbackDispatcher);
    final storage = StorageService.instance;
    await storage.init();
    final lastScheduled = await storage.getLastDailyTaskScheduledAt();
    final shouldSchedule = lastScheduled == null ||
        DateTime.now()
                .difference(DateTime.tryParse(lastScheduled) ?? DateTime(0))
                .inHours >=
            20;
    if (shouldSchedule) {
      final locale = (await AppCountryResolver.resolveContext()).uiLanguageCode;
      final delay = ScheduleConfig.delayUntilNextSlot(locale);
      await Workmanager().registerOneOffTask(
        AppConstants.taskDailyDealCheck,
        AppConstants.taskDailyDealCheck,
        initialDelay: delay,
        existingWorkPolicy: ExistingWorkPolicy.replace,
      );
      await storage.setLastDailyTaskScheduledAt(
          DateTime.now().toUtc().toIso8601String());
    }

    final lastWishlist = await storage.getLastWishlistTaskScheduledAt();
    final shouldScheduleWishlist = lastWishlist == null ||
        DateTime.now()
                .difference(DateTime.tryParse(lastWishlist) ?? DateTime(0))
                .inHours >=
            20;
    if (shouldScheduleWishlist) {
      final locale = (await AppCountryResolver.resolveContext()).uiLanguageCode;
      final delayWishlist = ScheduleConfig.delayUntilNextSlot(locale);
      await Workmanager().registerOneOffTask(
        AppConstants.taskWishlistCheck,
        AppConstants.taskWishlistCheck,
        initialDelay: delayWishlist,
        existingWorkPolicy: ExistingWorkPolicy.replace,
      );
      await storage.setLastWishlistTaskScheduledAt(
          DateTime.now().toUtc().toIso8601String());
    }
  } catch (e) {
    debugPrint('Workmanager.init: $e');
  }
}
