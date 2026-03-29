import 'package:flutter/material.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:workmanager/workmanager.dart';
import '../app.dart';
import '../screens/detail_screen.dart';
import 'constants.dart';
import 'schedule_config.dart';
import 'storage_service.dart';

class NotificationService {
  static NotificationService? _instance;
  static NotificationService get instance => _instance ??= NotificationService();

  final FlutterLocalNotificationsPlugin notificationsPlugin =
      FlutterLocalNotificationsPlugin();

  /// 冷启动时由通知带入的 payload，MainPage 首帧后取走并跳转详情
  static String? _pendingNotificationPayload;

  static String? getPendingNotificationPayload() => _pendingNotificationPayload;
  static void clearPendingNotificationPayload() {
    _pendingNotificationPayload = null;
  }
  /// 点击通知时若 Navigator 尚未就绪，可先存下 payload，首帧后再跳转
  static void setPendingNotificationPayload(String? payload) {
    _pendingNotificationPayload = payload;
  }

  Future<void> init() async {
    const android = AndroidInitializationSettings('@mipmap/ic_launcher');
    const settings = InitializationSettings(android: android);
    await notificationsPlugin.initialize(
      settings,
      onDidReceiveNotificationResponse: _onNotificationTap,
    );
    await _createPriceAlertChannel();
    await _createDailyChannel();
    try {
      final launchDetails = await notificationsPlugin.getNotificationAppLaunchDetails();
      if (launchDetails?.didNotificationLaunchApp == true) {
        final payload = launchDetails?.notificationResponse?.payload;
        if (payload != null && payload.isNotEmpty) {
          _pendingNotificationPayload = payload;
        }
      }
    } catch (_) {}
  }

  /// 语言/地区切换后重新预约 11:00 / 17:00 / 20:00（按新时区）
  Future<void> rescheduleDaily() async {
    try {
      final storage = StorageService.instance;
      await storage.init();
      final locale = await storage.getPreferredLocale();
      final delay = ScheduleConfig.delayUntilNextSlot(locale);
      await Workmanager().registerOneOffTask(
        AppConstants.taskDailyDealCheck,
        AppConstants.taskDailyDealCheck,
        initialDelay: delay,
        existingWorkPolicy: ExistingWorkPolicy.replace,
      );
      await storage.setLastDailyTaskScheduledAt(DateTime.now().toUtc().toIso8601String());
      final delayWishlist = ScheduleConfig.delayUntilNextSlot(locale);
      await Workmanager().registerOneOffTask(
        AppConstants.taskWishlistCheck,
        AppConstants.taskWishlistCheck,
        initialDelay: delayWishlist,
        existingWorkPolicy: ExistingWorkPolicy.replace,
      );
      await storage.setLastWishlistTaskScheduledAt(DateTime.now().toUtc().toIso8601String());
    } catch (e) {
      debugPrint('rescheduleDaily: $e');
    }
  }

  /// 创建 price_alert channel（闭环：安装 → 请求权限 → 创建 Channel → 后台发通知）
  Future<void> _createPriceAlertChannel() async {
    try {
      const channel = AndroidNotificationChannel(
        'price_alert',
        'Price Alerts',
        description: 'Wishlist price drop alerts',
        importance: Importance.max,
        playSound: true,
      );
      await notificationsPlugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(channel);
    } catch (e) {
      debugPrint('createPriceAlertChannel: $e');
    }
  }

  /// 创建每日折扣提醒 channel（与 _scheduleDaily8Am 使用的 daily_channel 一致，否则通知可能不显示）
  Future<void> _createDailyChannel() async {
    try {
      const channel = AndroidNotificationChannel(
        'daily_channel',
        'Daily Deals',
        description: 'Daily Steam deal reminder',
        importance: Importance.high,
        playSound: true,
      );
      await notificationsPlugin
          .resolvePlatformSpecificImplementation<
              AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(channel);
    } catch (e) {
      debugPrint('createDailyChannel: $e');
    }
  }

  static void _onNotificationTap(NotificationResponse response) {
    final payload = response.payload;
    if (payload == null || payload.isEmpty) return;
    // 汇总/多游戏类通知只打开首页，不进入详情
    if (payload == AppConstants.payloadTop5) return;
    final nav = navigatorKey.currentState;
    if (nav != null) {
      nav.push(MaterialPageRoute(
        builder: (_) => DetailScreen(appId: payload),
      ));
    } else {
      // 应用从后台被点击通知唤醒时 Navigator 可能尚未就绪，先存 payload，MainPage 首帧后会跳转
      setPendingNotificationPayload(payload);
    }
  }

  /// 价格提醒专用 channel（与 _createPriceAlertChannel 一致，importance.max）
  static const AndroidNotificationDetails priceAlertChannel = AndroidNotificationDetails(
    'price_alert',
    'Price Alerts',
    channelDescription: 'Wishlist price drop alerts',
    importance: Importance.max,
    priority: Priority.high,
  );

  /// FCM 前台通知与系统推送使用同一渠道（须先 [ensureFcmChannel]）。
  Future<void> ensureFcmChannel() async {
    try {
      const channel = AndroidNotificationChannel(
        'fcm_default',
        'Push (FCM)',
        description: 'Server deal and promo alerts',
        importance: Importance.high,
        playSound: true,
      );
      await notificationsPlugin
          .resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()
          ?.createNotificationChannel(channel);
    } catch (e) {
      debugPrint('ensureFcmChannel: $e');
    }
  }

  Future<void> showFcmNotification({
    required String title,
    required String body,
    String? payload,
  }) async {
    const android = AndroidNotificationDetails(
      'fcm_default',
      'Push (FCM)',
      channelDescription: 'Server deal and promo alerts',
      importance: Importance.high,
      priority: Priority.high,
    );
    final details = NotificationDetails(android: android);
    final id = DateTime.now().millisecondsSinceEpoch % 100000;
    await notificationsPlugin.show(id, title, body, details, payload: payload);
  }

  Future<void> showNotification(
    String title,
    String body, {
    int? notificationId,
    String? payload,
    bool usePriceAlertChannel = false,
  }) async {
    final androidDetails = usePriceAlertChannel
        ? priceAlertChannel
        : const AndroidNotificationDetails(
            'deal_channel',
            'Deals',
            channelDescription: 'Steam deal alerts',
            importance: Importance.high,
            priority: Priority.high,
          );

    final details = NotificationDetails(android: androidDetails);

    final id = notificationId ?? (DateTime.now().millisecondsSinceEpoch % 100000);
    await notificationsPlugin.show(id, title, body, details, payload: payload);
  }
}
