# Steam Backend（/server）部署说明

本说明覆盖：
1. 本地启动 `/server`
2. Cloud Run 部署
3. 环境变量清单
4. Flutter 侧 `API_BASE_URL` 配置

---

## 1) 本地启动

在项目根目录执行：

```bash
cd server
cp .env.example .env
```

然后按你的账号信息补齐 `.env`：
- `JWT_SECRET`：一段足够随机的字符串
- `STEAM_API_KEY`：Steam Web API Key
- `FIREBASE_PROJECT_ID`：你的 Firebase 项目 ID
- `GOOGLE_APPLICATION_CREDENTIALS`：本地服务账号 JSON 路径（用于 Firebase Admin SDK）
- `STEAM_OPENID_REALM` / `STEAM_OPENID_RETURN_URL` / `APP_BASE_URL`：使用本机地址（例如 `http://localhost:8080`）

本地开发启动：

```bash
npm install
npm run dev
```

默认监听端口：`process.env.PORT`（`.env.example` 为 8080）

---

## 2) Cloud Run 部署

建议服务名：`steam-backend`（可自定义）。

1. 先在 Google Cloud 控制台或 CLI 确保：
   - Cloud Run 服务可访问 Firestore（通常用默认服务账号即可）
   - 当前环境有必要的权限（部署权限 + 访问 Firestore/Admin）
2. 部署前准备必需参数：
   - `SERVICE_URL`：Cloud Run 部署后的公网 URL（部署完成后可从控制台/CLI 获取）

将环境变量设置为：
- `PORT=8080`
- `APP_BASE_URL=https://<SERVICE_URL>`（不带路径）
- `STEAM_OPENID_REALM=https://<SERVICE_URL>`（不带路径）
- `STEAM_OPENID_RETURN_URL=https://<SERVICE_URL>/auth/steam/callback`
- `APP_DEEPLINK_SCHEME=myapp`（必须与前端 Android/iOS 的 scheme 一致）

部署命令示例（把 `<REGION>`、`<PROJECT_ID>`、`<JWT_SECRET>` 等替换为你的值）：

```bash
gcloud run deploy steam-backend \
  --project <PROJECT_ID> \
  --region <REGION> \
  --allow-unauthenticated \
  --source . \
  --port 8080 \
  --set-env-vars \
    PORT=8080,\
    JWT_SECRET='<JWT_SECRET>',\
    JWT_EXPIRES_IN='30d',\
    STEAM_API_KEY='<STEAM_API_KEY>',\
    STEAM_HTTP_TIMEOUT_MS=8000,\
    APP_DEEPLINK_SCHEME='myapp',\
    APP_BASE_URL='https://<SERVICE_URL>',\
    STEAM_OPENID_REALM='https://<SERVICE_URL>',\
    STEAM_OPENID_RETURN_URL='https://<SERVICE_URL>/auth/steam/callback',\
    FIREBASE_PROJECT_ID='<FIREBASE_PROJECT_ID>'
```

说明：
- `--allow-unauthenticated`：用于保证 `/auth/steam/start`、`/auth/steam/callback` 能被 Steam 回调访问；其它需要 JWT 的接口会在代码层校验 `Authorization: Bearer <token>`。
- Firestore 权限：建议通过 Cloud Run 默认服务账号赋予 Firestore 权限；生产环境不一定需要 `GOOGLE_APPLICATION_CREDENTIALS`。

---

## 3) Cloud Run /server 需要的环境变量

参见 `server/.env.example`：
- `PORT`
- `JWT_SECRET`
- `JWT_EXPIRES_IN`（默认 `30d`）
- `STEAM_API_KEY`
- `STEAM_OPENID_REALM`
- `STEAM_OPENID_RETURN_URL`
- `APP_DEEPLINK_SCHEME`（默认 `myapp`）
- `APP_BASE_URL`（后端公网地址）
- `FIREBASE_PROJECT_ID`
- `GOOGLE_APPLICATION_CREDENTIALS`（仅本地需要；Cloud Run 建议用默认 SA/ADC）
- `STEAM_HTTP_TIMEOUT_MS`

---

## 4) Flutter 侧 API 基础地址

Flutter 在深链路回跳后会请求后端接口，因此需要在构建时设置：

```bash
--dart-define=API_BASE_URL='https://<SERVICE_URL>'
```

例如：

```bash
flutter build appbundle --release \
  --dart-define=API_BASE_URL='https://<SERVICE_URL>'
```

