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

---

## 后端部署（Cloud Run + Firestore）

完整部署文档见：`docs/deployment.md`

### 本地开发步骤（server）

```bash
cd server
cp .env.example .env
npm install
npm run dev
```

健康检查：

```bash
curl http://localhost:8080/health
```

### Firestore 配置步骤

1. 在 GCP 启用 Firestore（Native mode）  
2. 本地开发：`GOOGLE_APPLICATION_CREDENTIALS` 指向 service account json  
3. Cloud Run：推荐使用默认服务账号（ADC），并赋予 Firestore 权限（如 `roles/datastore.user`）

### Steam API Key 配置步骤

1. 申请 Steam Web API Key  
2. 配置环境变量 `STEAM_API_KEY` 到后端  
3. 不要把该 Key 放在 Flutter 客户端

### Cloud Run 部署步骤

在 `server/` 下执行（按实际值替换）：

```bash
gcloud run deploy steam-game-api \
  --source . \
  --region=asia-southeast1 \
  --allow-unauthenticated \
  --set-env-vars=PORT=8080,NODE_ENV=production,JWT_SECRET=<JWT_SECRET>,STEAM_API_KEY=<STEAM_API_KEY>,STEAM_REALM=https://<YOUR_RUN_URL>,STEAM_RETURN_URL=https://<YOUR_RUN_URL>/auth/steam/callback,APP_DEEP_LINK_SCHEME=myapp,APP_DEEP_LINK_SUCCESS_HOST=auth,APP_DEEP_LINK_FAIL_HOST=auth,FIREBASE_PROJECT_ID=<FIREBASE_PROJECT_ID>
```

### Android 深链接配置说明

Steam 登录回跳使用：
- `myapp://auth/steam/success?token=...`
- `myapp://auth/steam/fail?reason=...`

请确保 AndroidManifest / iOS Info.plist 的 scheme 与后端 `APP_DEEP_LINK_SCHEME` 一致。

### Google Play 上架注意事项

1. 仅使用浏览器 OpenID，不在 App 内采集 Steam 密码  
2. 提供隐私说明，说明读取 Steam 公开资料与可见游戏数据  
3. 正式环境替换测试广告位/测试支付配置  
4. 上架前验证深链接登录回跳与 Firestore 权限
