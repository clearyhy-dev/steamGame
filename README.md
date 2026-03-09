# Steam Deal Alert

Flutter 安卓应用：Steam 折扣列表、愿望单、后台定时检测愿望单折扣并推送本地通知。

## 项目结构

```
lib/
├── main.dart
├── app.dart
├── core/
│   ├── theme.dart
│   ├── constants.dart
│   ├── storage_service.dart      # 愿望单与缓存本地存储
│   ├── notification_service.dart # 本地通知
│   └── background_task.dart      # WorkManager 后台任务（每 8 小时检测愿望单是否达到目标折扣）
├── models/
│   ├── game_model.dart
│   └── wishlist_model.dart
├── services/
│   └── steam_api_service.dart    # 折扣 API（需配置你的 API 或使用模拟数据）
├── screens/
│   ├── home_screen.dart
│   ├── search_screen.dart
│   ├── detail_screen.dart
│   └── wishlist_screen.dart
└── widgets/
    ├── game_card.dart
    ├── discount_badge.dart
    └── ad_banner.dart
```

## 运行

1. 安装依赖：`flutter pub get`
2. 连接设备或模拟器后运行：`flutter run`

若本地 Dart SDK 过旧，可先执行 `flutter upgrade` 再 `flutter pub get`。

## 配置说明

- **Steam 折扣 API**：在 `lib/services/steam_api_service.dart` 中修改 `baseUrl`，并保证接口返回格式为 JSON 数组，元素包含：`appid`、`name`、`image`、`price`、`original_price`、`discount_percent`。未配置或请求失败时会使用内置模拟数据。
- **广告**：`lib/widgets/ad_banner.dart` 当前为占位，接入 Google AdMob 时需在 AndroidManifest 与 AdMob 后台配置 App ID / 广告位 ID 后取消注释相关代码。
- **后台任务**：WorkManager 每 8 小时执行一次（`main.dart` 中 `registerPeriodicTask`），在 `core/background_task.dart` 中拉取愿望单、按 appId 请求当前折扣，若 `latest.discount >= game.targetDiscount` 则发送本地通知。愿望单条目支持 `targetDiscount`（目标折扣百分比）。
- **AdMob**：`widgets/ad_banner.dart` 使用测试 ID `ca-app-pub-3940256099942544/6300978111`，上线前请替换为真实广告位 ID。

## 依赖

- `http`：请求折扣 API  
- `shared_preferences`：愿望单与缓存  
- `workmanager`：后台周期任务  
- `flutter_local_notifications`：本地通知  
- `google_mobile_ads`：广告（当前仅占位）
