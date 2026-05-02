import 'dart:async';
import 'dart:io' show Platform;

import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

import '../app.dart';
import 'navigation/game_detail_navigation.dart';
import 'notification_service.dart';
import 'storage_service.dart';

/// FCM：令牌持久化、前台展示本地通知、点击进详情（payload: dealId / appId）。
class FcmService {
  FcmService._();
  static final FcmService instance = FcmService._();

  bool _inited = false;

  Future<void> init() async {
    if (_inited) return;
    if (kIsWeb) {
      _inited = true;
      return;
    }
    _inited = true;

    final messaging = FirebaseMessaging.instance;
    if (Platform.isIOS) {
      await messaging.requestPermission(
        alert: true,
        badge: true,
        sound: true,
      );
      await messaging.setForegroundNotificationPresentationOptions(
        alert: true,
        badge: true,
        sound: true,
      );
    }

    await NotificationService.instance.ensureFcmChannel();

    FirebaseMessaging.onMessage.listen(_onForeground);
    FirebaseMessaging.onMessageOpenedApp.listen(_onOpened);

    final initial = await messaging.getInitialMessage();
    if (initial != null) {
      _handlePayload(initial.data);
    }

    try {
      final token = await messaging.getToken();
      if (token != null && token.isNotEmpty) {
        final preview = token.length > 12 ? '${token.substring(0, 12)}…' : token;
        debugPrint('FCM token: $preview');
        if (StorageService.instance.isInitialized) {
          await StorageService.instance.setFcmToken(token);
        } else {
          await StorageService.instance.init();
          await StorageService.instance.setFcmToken(token);
        }
      }
    } catch (e) {
      debugPrint('FCM getToken: $e');
    }

    FirebaseMessaging.instance.onTokenRefresh.listen((t) {
      unawaited(_persistFcmToken(t));
    });
  }

  Future<void> _persistFcmToken(String t) async {
    if (!StorageService.instance.isInitialized) {
      await StorageService.instance.init();
    }
    await StorageService.instance.setFcmToken(t);
  }

  void _onForeground(RemoteMessage message) {
    final title = message.notification?.title ??
        (message.data['title'] is String ? message.data['title'] as String : null) ??
        'Steam Deal';
    final body = message.notification?.body ??
        (message.data['body'] is String ? message.data['body'] as String : null) ??
        '';
    final raw = message.data['dealId'] ?? message.data['appId'] ?? message.data['payload'];
    final payload = raw == null ? null : raw.toString();
    unawaited(
      NotificationService.instance.showFcmNotification(
        title: title,
        body: body,
        payload: payload,
      ),
    );
  }

  void _onOpened(RemoteMessage message) {
    _handlePayload(message.data);
  }

  void _handlePayload(Map<String, dynamic> data) {
    final raw = data['dealId'] ?? data['appId'] ?? data['payload'];
    if (raw == null) return;
    final payload = raw.toString();
    if (payload.isEmpty) return;

    final nav = navigatorKey.currentState;
    if (nav != null) {
      nav.push(
        gameDetailRouteByAppId(payload),
      );
    } else {
      NotificationService.setPendingNotificationPayload(payload);
    }
  }
}
