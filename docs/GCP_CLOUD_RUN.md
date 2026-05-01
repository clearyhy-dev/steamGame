# 将 API + 管理后台部署到 Google Cloud Run（gcloud）

同一容器内包含：

- Express API（`/api`、`/auth`、`/v1` 等）
- 管理后台静态站点（`admin` 构建产物，路径 **`/admin/`**）
- `ffmpeg` + `yt-dlp`（视频处理 Worker；若只做 API 可改用精简镜像并关闭流水线）

## 0. 首次使用前

- 在目标项目启用 API（控制台或 CLI 一次即可）：Artifact Registry、Cloud Build、Cloud Run；若用 Secret Manager 再启用 Secret Manager。
- **本机无需安装 Docker**：`gcloud builds submit` 在 Google 云端构建；本机只需安装 [Google Cloud SDK](https://cloud.google.com/sdk) 并完成 `gcloud auth login`、`gcloud config set project PROJECT_ID`。

## 1. 构建镜像

在项目根目录（含 `Dockerfile`）执行：

```bash
gcloud builds submit --tag REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/IMAGE_NAME:latest .
```

或使用 Artifact Registry / Cloud Build 触发器指向该 `Dockerfile`。

**PowerShell（Windows）** 同样在仓库根目录执行上述命令；路径中含空格时用引号包住 `.`。

## 2. 部署 Cloud Run

```bash
gcloud run deploy SERVICE_NAME \
  --image REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/IMAGE_NAME:latest \
  --region REGION \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600 \
  --max-instances 3 \
  --set-env-vars "NODE_ENV=production,SERVE_ADMIN_STATIC=true"
```

### 敏感配置（推荐 Secret Manager）

通过控制台或 CLI 挂载 Secret，勿把密码写进镜像。至少需要：

| 变量 | 说明 |
|------|------|
| `JWT_SECRET` | 应用 JWT |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 后台登录 |
| `ADMIN_JWT_SECRET` | 可选，默认同 `JWT_SECRET` |
| `STEAM_API_KEY`、`STEAM_REALM`、`STEAM_RETURN_URL` | Steam |
| `APP_BASE_URL` | 例如 `https://YOUR-SERVICE-xx.a.run.app`（与浏览器访问的 Cloud Run URL 一致） |
| `FIREBASE_PROJECT_ID` | Firestore |
| `VIDEO_GCS_BUCKET` | 视频走 GCS 时填写桶名 |

在 Secret Manager 中创建密钥版本后，部署时挂载到环境变量（示例名称请与项目一致）：

```bash
gcloud run deploy SERVICE_NAME \
  --image REGION-docker.pkg.dev/PROJECT_ID/REPOSITORY/IMAGE_NAME:latest \
  --region REGION \
  --platform managed \
  --allow-unauthenticated \
  --memory 2Gi \
  --cpu 2 \
  --timeout 3600 \
  --max-instances 3 \
  --set-env-vars "NODE_ENV=production,SERVE_ADMIN_STATIC=true,FIREBASE_PROJECT_ID=your-project" \
  --set-secrets "JWT_SECRET=jwt-secret:latest,ADMIN_PASSWORD=admin-password:latest,STEAM_API_KEY=steam-api-key:latest"
```

非敏感变量仍可用 `--set-env-vars`；密钥版本 `:latest` 可按需改为固定版本号。

Cloud Run **不要**设置 `GOOGLE_APPLICATION_CREDENTIALS` 文件路径；使用 **附加服务账号**，Firebase Admin 走 **ADC**，需为该账号授予：

- Firestore 读写  
- （若用 GCS 视频桶）`storage.objects.create/delete/get` 等  

### CORS（可选）

若 Flutter / Web 客户端与 API **不同源**，设置：

```text
CORS_ORIGINS=https://your-app.example.com,https://xxx.web.app
```

同源访问 Cloud Run（页面与接口同一域名）一般不需要。

### 后台静态路径（可选）

默认静态目录为容器内 **`/app/admin/dist`**（与根 `Dockerfile` 一致）。

自定义：

```text
ADMIN_DIST_PATH=/custom/path/to/dist
```

关闭挂载 UI（仅 API）：

```text
SERVE_ADMIN_STATIC=false
```

## 3. 访问方式

部署完成后：

- API：`https://YOUR-SERVICE-xxx.run.app/api/...`
- 管理后台：**`https://YOUR-SERVICE-xxx.run.app/admin/`**

将 `APP_BASE_URL` 设为同一 `https://YOUR-SERVICE-xxx.run.app`（或你的自定义域名），便于回调与链接一致。

## 4. 视频流水线与资源

- **CPU/内存**：转码建议 **≥ 2 vCPU、2GiB**，`--timeout` 加长（如 3600s）。
- **并发**：Worker 使用进程内定时器；多实例可能并发消费任务，Firestore 事务防重可减少重复（后续可增强）。
- **镜像体积**：已含 `ffmpeg`、`yt-dlp`；若仅调试 API，可暂时用不含媒体的精简镜像并在代码侧跳过 Worker。

## 5. 与本仓库脚本的关系

- 根目录 **`Dockerfile`**：Admin + Server + 媒体依赖，适合 Cloud Run 一站式部署。
- **`server/Dockerfile`**：仅编译后端，不含 Admin UI；适合只要 API 的场景。
- **`scripts/deploy-cloud-run.ps1`**（Windows）：在仓库根目录设置可写临时目录后执行 `gcloud run deploy`，与 README「方式 B」等价；若本机仍报上传失败，见下一节。

## 6. Windows：gcloud 上传源码 `Permission denied`

在 PowerShell 执行 `gcloud run deploy --source .` 时，若卡在 **Uploading sources** 并报 `PermissionError: [Errno 13] Permission denied`，多为本机对 **`%APPDATA%\gcloud`**、**`%TEMP%`** 或终端工作目录无写权限。

建议顺序排查：

1. **管理员 PowerShell** 再运行一次部署，或对本机用户授予 `AppData\Roaming\gcloud` 目录的修改权限。
2. 使用仓库自带脚本（将临时目录指到仓库内 `.deploy-tmp`）：在仓库根目录执行 `.\scripts\deploy-cloud-run.ps1`。
3. 关闭可能锁定文件的杀毒/同步软件后重试；或将本仓库路径加入排除列表。
4. 换用 **Google Cloud Shell**：将代码推送到 GitHub/Git，在 Cloud Shell `git clone` 后在同一目录执行 README 中的 `gcloud run deploy`（云端无本机权限问题）。
5. 不改本机时，也可用 **Artifact Registry**：在能构建 Docker 的环境 `docker build` 后 `gcloud run deploy --image ...`（见本文第 1～2 节）。
