import 'package:workmanager/workmanager.dart';
import '../models/game_model.dart';
import '../services/steam_api_service.dart';
import '../l10n/app_localizations.dart';
import 'constants.dart';
import 'schedule_config.dart';
import 'storage_service.dart';
import 'notification_service.dart';
import 'shock_deal_algorithm.dart';
import 'utils/score_calculator.dart' show calculateScore;

/// 后台任务：每天 11:00 / 17:00 / 20:00 今日折扣 + Pro 愿望单（按所选地区语言时区），通知文案随语言
@pragma('vm:entry-point')
void callbackDispatcher() {
  Workmanager().executeTask((task, inputData) async {
    final api = SteamApiService();
    final storage = StorageService.instance;
    final notification = NotificationService.instance;

    await storage.init();
    await notification.init();
    final locale = await storage.getPreferredLocale();

    final isWishlistTask = task == AppConstants.taskWishlistCheck;
    final isDaily = task == AppConstants.taskDailyDealCheck;

    // 1) 11:00 / 17:00 / 20:00：Pro 愿望单检测与推送（按语言时区）
    if (isWishlistTask) {
      final isPro = await storage.isPro();
      if (!isPro) {
        await _rescheduleWishlist(storage);
        return Future.value(true);
      }
      final wishlist = await storage.getWishlist();
      final lastDiscounts = await storage.getLastKnownDiscounts();
      final priceDropTitle = AppLocalizations.getStringForLocale(locale, 'notification_price_drop_title');
      final bodyTpl = AppLocalizations.getStringForLocale(locale, 'notification_price_drop_body');
      for (var game in wishlist) {
        final latest = await api.fetchGameById(game.appId);
        final lastDiscount = lastDiscounts[game.appId];
        final currentDiscount = latest.discount;
        if (lastDiscount != null && currentDiscount > lastDiscount) {
          final priceStr = latest.price > 0
              ? '\$${latest.price.toStringAsFixed(2)}'
              : '$currentDiscount% OFF';
          final title = '🔥 $priceDropTitle';
          final body = bodyTpl.replaceAll('{gameName}', latest.name).replaceAll('{price}', priceStr);
          await notification.showNotification(
            title,
            body,
            notificationId: game.appId.hashCode.abs() % 100000 + 10000,
            payload: latest.steamAppID.isNotEmpty ? latest.steamAppID : latest.appId,
            usePriceAlertChannel: true,
          );
        }
        await storage.setLastKnownDiscount(game.appId, currentDiscount);
      }
      await _rescheduleWishlist(storage);
      return Future.value(true);
    }

    // 2) 11:00 / 17:00 / 20:00：今日折扣（按语言时区，每天轮换一款游戏推送），文案随语言
    if (isDaily) {
      const pageSize = 60;
      var deals = await api.fetchDeals(pageSize: pageSize, pageNumber: 0);
      deals = ShockDealAlgorithm.deduplicateDeals(deals);
      if (deals.isEmpty) {
        await _rescheduleDaily(storage);
        return Future.value(true);
      }

      final titleTpl = AppLocalizations.getStringForLocale(locale, 'notification_deal_title');
      final bodyTpl = AppLocalizations.getStringForLocale(locale, 'notification_deal_body');
      final list = List<GameModel>.from(deals);
      list.sort((a, b) => calculateScore(b).compareTo(calculateScore(a)));
      final topN = list.take(15).toList();
      if (topN.isNotEmpty) {
        final dayOfYear = DateTime.now().difference(DateTime(DateTime.now().year, 1, 1)).inDays;
        final index = dayOfYear % topN.length;
        final game = topN[index];
        final priceStr = game.price > 0
            ? '\$${game.price.toStringAsFixed(2)}'
            : '${game.discount}% OFF';
        final title = '🔥 ${titleTpl.replaceAll('{gameName}', game.name).replaceAll('{discount}', '${game.discount}').replaceAll('{price}', priceStr)}';
        final body = bodyTpl.replaceAll('{price}', priceStr);
        await notification.showNotification(
          title,
          body,
          notificationId: 99998,
          payload: game.steamAppID.isNotEmpty ? game.steamAppID : game.appId,
        );
      }

      // 3) 二次唤醒：超过 N 天未打开则发召回通知（文案随语言）
      final lastOpen = await storage.getLastOpenDate();
      if (lastOpen != null && lastOpen.isNotEmpty) {
        try {
          final last = DateTime.parse(lastOpen);
          final daysInactive = DateTime.now().difference(last).inDays;
          if (daysInactive >= AppConstants.reengagementDaysInactive) {
            final today = DateTime.now().toIso8601String().substring(0, 10);
            final lastRe = await storage.getLastReengagementDate();
            if (lastRe != today) {
              final reTitle = AppLocalizations.getStringForLocale(locale, 'notification_reengagement_title');
              final reBody = AppLocalizations.getStringForLocale(locale, 'notification_reengagement_body');
              await notification.showNotification(
                '🔥 $reTitle',
                reBody,
                notificationId: 99995,
                payload: AppConstants.payloadTop5,
              );
              await storage.setLastReengagementDate(today);
            }
          }
        } catch (_) {}
      }

      await _rescheduleDaily(storage);
    }

    return Future.value(true);
  });
}

Future<void> _rescheduleDaily(StorageService storage) async {
  final locale = await storage.getPreferredLocale();
  final delay = ScheduleConfig.delayUntilNextSlot(locale);
  await Workmanager().registerOneOffTask(
    AppConstants.taskDailyDealCheck,
    AppConstants.taskDailyDealCheck,
    initialDelay: delay,
    existingWorkPolicy: ExistingWorkPolicy.replace,
  );
  await storage.setLastDailyTaskScheduledAt(DateTime.now().toUtc().toIso8601String());
}

Future<void> _rescheduleWishlist(StorageService storage) async {
  final locale = await storage.getPreferredLocale();
  final delay = ScheduleConfig.delayUntilNextSlot(locale);
  await Workmanager().registerOneOffTask(
    AppConstants.taskWishlistCheck,
    AppConstants.taskWishlistCheck,
    initialDelay: delay,
    existingWorkPolicy: ExistingWorkPolicy.replace,
  );
  await storage.setLastWishlistTaskScheduledAt(DateTime.now().toUtc().toIso8601String());
}
