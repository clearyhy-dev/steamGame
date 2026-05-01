# 游戏视频管理后台（Admin）

## 本地运行

### 1. 后端 `server/`

在 `server` 目录配置 `.env`（或环境变量），除原有项外增加：

| 变量 | 说明 |
|------|------|
| `ADMIN_USERNAME` | 管理员用户名（默认 `admin`） |
| `ADMIN_PASSWORD` | 管理员密码（不设置则无法登录） |
| `ADMIN_JWT_SECRET` | 可选，缺省与 `JWT_SECRET` 相同 |
| `VIDEO_GCS_BUCKET` | 处理模式上传用 GCS 桶名 |
| `FFMPEG_PATH` / `FFPROBE_PATH` / `YTDLP_PATH` | 可选，默认可从 PATH 找 `ffmpeg` / `ffprobe` / `yt-dlp` |

启动：

```bash
cd server
npm install
npm run dev
```

默认可用 `http://127.0.0.1:8080`；健康检查 `GET /health`。

### 2. 管理前端 `admin/`

```bash
cd admin
npm install
npm run dev
```

浏览器打开：**http://localhost:5173/admin/**（Vite 已配置 `base: '/admin/'`）。  
开发时通过 Vite 代理将 `/api` 转发到 `http://127.0.0.1:8080`（见 `admin/vite.config.ts`，可用 `VITE_PROXY_TARGET` 覆盖）。

生产构建：`npm run build`，静态资源输出在 `admin/dist/`；部署时需让 Web 服务器把 `/admin` 指到该目录，并把 `/api` 反向代理到 Node 服务。

## Firestore 集合

| 集合 | 用途 |
|------|------|
| `video_sources` | 来源：youtube / steam / manual，`ingestMode` embed/process |
| `videos` | 视频记录与状态、播放与存储信息 |
| `video_jobs` | 采集/重处理任务队列 |

字段与后台列表、详情一致；时间字段在 API 中为 ISO 字符串。

## 主要 HTTP 接口

- 管理：`/api/admin/*`（JWT：`Authorization: Bearer <token>`）
- 公开：`GET /api/videos`、`GET /api/videos/:videoId`、`GET /api/videos/:videoId/playback`

响应格式：`{ ok, data, message }`。

## Docker / 部署建议

**Google Cloud Run（推荐）**：仓库根目录 `Dockerfile` 会同时构建 **Admin（`/admin/`）+ API**，并在镜像内安装 `ffmpeg`、`yt-dlp`。部署步骤、环境变量与 Secret 约定见 **[GCP_CLOUD_RUN.md](./GCP_CLOUD_RUN.md)**。部署后后台地址为 `https://<你的服务>.run.app/admin/`；Admin 前端使用相对路径请求 `/api`，与 API 同源即可。

**自建容器 / Nginx**：若不用 Cloud Run，需自行提供 Node 进程与静态目录；视频流水线仍需 `ffmpeg` / `yt-dlp` 与可选的 GCS 桶。Worker 随 `server` 进程启动（`startVideoWorker`）；多实例可能重复消费任务，生产上可酌情限制 `--max-instances 1` 或后续接队列。

## 后续可扩展

- Firestore 复合索引与服务端分页筛选
- 任务队列（Cloud Tasks / Pub/Sub）替代轮询 Worker
- 批量操作与审计日志
