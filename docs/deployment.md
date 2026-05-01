# Steam Game API 部署指南（Cloud Run + Firestore）

本指南对应仓库中的 `server/` 后端服务，目标是部署到 **Google Cloud Run**，并使用 **Firestore** 作为数据库。

## 1. 前置准备

- 已安装并登录 `gcloud` CLI
- 已启用 GCP API：
  - Cloud Run API
  - Cloud Build API
  - Artifact Registry API
  - Firestore API
- 已有 GCP Project（下文记为 `<PROJECT_ID>`）

## 2. 环境变量

请先复制示例：

```bash
cd server
cp .env.example .env
```

`server/.env.example` 已包含：

```env
PORT=
NODE_ENV=
JWT_SECRET=
STEAM_API_KEY=
STEAM_REALM=
STEAM_RETURN_URL=
APP_DEEP_LINK_SCHEME=
APP_DEEP_LINK_SUCCESS_HOST=
APP_DEEP_LINK_FAIL_HOST=
FIREBASE_PROJECT_ID=
GOOGLE_APPLICATION_CREDENTIALS=
```

说明：
- `STEAM_RETURN_URL` 必须是线上可访问地址，通常为  
  `https://<cloud-run-domain>/auth/steam/callback`
- `APP_DEEP_LINK_SCHEME` 需要与 Flutter 端配置一致（当前默认 `myapp`）
- `GOOGLE_APPLICATION_CREDENTIALS`：
  - 本地开发：填写 service account json 路径
  - Cloud Run：推荐留空，使用默认服务账号（ADC）

## 3. Firestore 配置

### 3.1 创建 Firestore

在 GCP Console 中启用 Firestore（Native mode）。

### 3.2 权限配置

Cloud Run 运行账号需具备 Firestore 读写权限，至少：
- `roles/datastore.user`

若需要更高权限可使用：
- `roles/datastore.owner`（不建议长期生产使用）

### 3.3 Firebase Admin SDK 初始化模式

后端已支持双模式：

1) 本地 service account json  
- 设置 `GOOGLE_APPLICATION_CREDENTIALS=/path/to/serviceAccount.json`
- 启动时读取 JSON 并初始化 `admin.credential.cert(...)`

2) Cloud Run ADC（推荐）  
- 不设置 `GOOGLE_APPLICATION_CREDENTIALS`
- 自动使用 `admin.credential.applicationDefault()`

若初始化失败，服务会抛出清晰错误（例如 JSON 路径不存在/格式错误）。

## 4. 本地开发启动

```bash
cd server
npm install
npm run dev
```

健康检查：

```bash
curl http://localhost:8080/health
```

## 5. Docker 构建说明

`server/Dockerfile` 已采用多阶段构建：
- builder 阶段安装依赖并编译 TypeScript
- runner 阶段仅安装生产依赖并运行 `dist/index.js`

服务监听：
- `0.0.0.0`
- `process.env.PORT`

符合 Cloud Run 无状态运行要求（不依赖本地磁盘持久化）。

## 6. Cloud Run 部署

在 `server/` 目录执行示例命令：

```bash
gcloud run deploy steam-game-api \
  --source . \
  --project=<PROJECT_ID> \
  --region=asia-southeast1 \
  --allow-unauthenticated \
  --set-env-vars=NODE_ENV=production,JWT_SECRET=<JWT_SECRET>,STEAM_API_KEY=<STEAM_API_KEY>,STEAM_REALM=https://<YOUR_RUN_URL>,STEAM_RETURN_URL=https://<YOUR_RUN_URL>/auth/steam/callback,APP_BASE_URL=https://<YOUR_RUN_URL>,APP_DEEP_LINK_SCHEME=myapp,APP_DEEP_LINK_SUCCESS_HOST=auth,APP_DEEP_LINK_FAIL_HOST=auth,FIREBASE_PROJECT_ID=<FIREBASE_PROJECT_ID>
```

部署后请把 `STEAM_REALM`、`STEAM_RETURN_URL` 中的域名更新为 Cloud Run 正式 URL。

### 一条命令部署（推荐，避免遗漏参数）

在仓库根目录执行：

```powershell
.\scripts\deploy-cloud-run.ps1 `
  -ProjectId "steamdeal" `
  -Region "asia-southeast1" `
  -Service "steam-game-api" `
  -ServiceUrl "https://steam-game-api-r7vmg7elga-as.a.run.app" `
  -JwtSecret "<YOUR_JWT_SECRET>" `
  -SteamApiKey "<YOUR_STEAM_API_KEY>" `
  -FirebaseProjectId "steamdeal" `
  -AdminUsername "admin" `
  -AdminPassword "<YOUR_ADMIN_PASSWORD>"
```

该脚本会同时更新常用运行参数（`APP_*`、`STEAM_*`、`ADMIN_*`、`FIREBASE_PROJECT_ID` 等），减少后续漏配。

## 7. 自定义域名（可选）

可在 Cloud Run > Custom domains 绑定域名（例如 `api.example.com`）。

完成后建议同步更新环境变量：
- `STEAM_REALM=https://api.example.com`
- `STEAM_RETURN_URL=https://api.example.com/auth/steam/callback`

Steam OpenID 回调地址也应配置为该正式域名。

## 8. Steam API Key 配置步骤

1. 在 Steam 开发者渠道申请 Web API Key  
2. 通过环境变量注入后端：`STEAM_API_KEY`  
3. 不要在 Flutter 端存放或直连 Steam Web API Key

## 9. Android 深链接配置说明

Flutter Android 端需要支持：
- `myapp://auth/steam/success?token=...`
- `myapp://auth/steam/fail?reason=...`

确保：
- `android/app/src/main/AndroidManifest.xml` 中已有对应 `intent-filter`
- iOS `Info.plist` 也配置了相同 scheme
- 后端 deep link 变量与前端一致：
  - `APP_DEEP_LINK_SCHEME`
  - `APP_DEEP_LINK_SUCCESS_HOST`
  - `APP_DEEP_LINK_FAIL_HOST`

## 10. Google Play 上架注意事项

1. 不在 App 内采集 Steam 密码（必须走浏览器 OpenID）  
2. 提供隐私说明，声明读取 Steam 公开资料/可见游戏数据用途  
3. 使用 AAB 发布，检查 `targetSdkVersion` 与政策要求一致  
4. 广告与订阅配置使用正式 ID（测试 ID 仅开发期）  
5. 深链接与登录回跳在正式包上实机验证  
6. Firestore/后端日志中避免输出敏感凭证

