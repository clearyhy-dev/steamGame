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
  
后端管理接口与作用总表见：`docs/BACKEND_ADMIN_APIS.md`

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

后端启动要求 `APP_BASE_URL`、`JWT_SECRET`、`STEAM_*`、`FIREBASE_PROJECT_ID` 等（见 `server/.env.example`）。部署完成后把 `STEAM_REALM`、`STEAM_RETURN_URL`、`APP_BASE_URL` 都改成 Cloud Run 显示的 **HTTPS 服务地址**（同一域名）。

**方式 A：仅部署 API（使用 `server/Dockerfile`，不含 Admin 静态页）**

在 `server/` 下执行（按实际值替换占位符）：

```bash
gcloud run deploy steam-game-api \
  --source . \
  --project=<PROJECT_ID> \
  --region=asia-southeast1 \
  --allow-unauthenticated \
  --set-env-vars=NODE_ENV=production,JWT_SECRET=<JWT_SECRET>,STEAM_API_KEY=<STEAM_API_KEY>,STEAM_REALM=https://<YOUR_RUN_URL>,STEAM_RETURN_URL=https://<YOUR_RUN_URL>/auth/steam/callback,APP_BASE_URL=https://<YOUR_RUN_URL>,APP_DEEP_LINK_SCHEME=myapp,APP_DEEP_LINK_SUCCESS_HOST=auth,APP_DEEP_LINK_FAIL_HOST=auth,FIREBASE_PROJECT_ID=<FIREBASE_PROJECT_ID>
```

**方式 B：API + 管理后台 + 视频依赖（推荐，使用仓库根目录 `Dockerfile`）**

在**仓库根目录**执行；镜像内含 Admin 构建产物、`ffmpeg`、`yt-dlp`。部署后后台地址为 `https://<YOUR_RUN_URL>/admin/`。

```bash
gcloud run deploy steam-game-api \
  --source . \
  --project=<PROJECT_ID> \
  --region=asia-southeast1 \
  --allow-unauthenticated \
  --memory=2Gi \
  --cpu=2 \
  --timeout=3600 \
  --update-env-vars=SERVE_ADMIN_STATIC=true,NODE_ENV=production,ADMIN_DIST_PATH=/app/admin/dist
```

若 **`/admin/` 返回 404**，多半是用了「方式 A」仅用 `server/Dockerfile` 部署，镜像里没有 `admin/dist`。请改用本节的**方式 B**（仓库根目录、`--source .` 指向含根 `Dockerfile` 的目录），或使用 `scripts/deploy-cloud-run.ps1`。

首次部署若无已有环境变量，请用 `--set-env-vars` 写明全部必填项（含 `ADMIN_USERNAME`、`ADMIN_PASSWORD`、`APP_BASE_URL` 等）；之后可用 `--update-env-vars` 增量修改。详见 `docs/GCP_CLOUD_RUN.md`。不要在 Cloud Run 控制台手动设置保留名 **`PORT`**（平台自动注入）。

（Windows）若本机 `gcloud` 上传报权限错误，可在仓库根目录执行 `.\scripts\deploy-cloud-run.ps1`，仍失败时见 `docs/GCP_CLOUD_RUN.md` 第 6 节。

### 一键发布（推荐）

为降低发布成本并减少参数遗忘，已提供两条脚本：

- `.\scripts\quick-deploy.ps1`：低成本快速发布（不触发 Cloud Build，仅更新 Cloud Run 运行参数/环境变量）
- `.\scripts\full-deploy.ps1`：完整发布（触发 Cloud Build 重新构建镜像）

示例（两者参数一致）：

```powershell
.\scripts\quick-deploy.ps1 `
  -ProjectId "steamdeal" `
  -Region "asia-southeast1" `
  -Service "steam-game-api" `
  -ServiceUrl "https://steam-game-api-r7vmg7elga-as.a.run.app" `
  -JwtSecret "<JWT_SECRET>" `
  -SteamApiKey "<STEAM_API_KEY>" `
  -FirebaseProjectId "steamdeal" `
  -AdminUsername "admin" `
  -AdminPassword "<ADMIN_PASSWORD>"
```

**当前项目已部署的服务地址示例（以 `gcloud run services describe` 为准）：**

- 服务 URL：`https://steam-game-api-r7vmg7elga-as.a.run.app`
- 健康检查：`https://steam-game-api-r7vmg7elga-as.a.run.app/health`
- 管理后台（需在方式 B 镜像且 `SERVE_ADMIN_STATIC=true`）：`https://steam-game-api-r7vmg7elga-as.a.run.app/admin/`

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
