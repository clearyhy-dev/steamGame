# Vultr 数据层（Redis + MinIO + SQLite Data API）

Cloud Run API **默认不再读 Firestore**（`DATA_STORE=vultr_sqlite`）：

| 数据 | 存储 |
|------|------|
| 大 JSON / 折扣分桶 / 视频 | MinIO `steamgame` 桶 |
| API 短缓存 / 今日已同步索引 | Redis |
| 游戏目录、配置、视频元数据等 | SQLite（经 **data-api :8090**） |

## 1. 在 Vultr 上安装

```bash
scp -r deploy/vultr root@YOUR_IP:/root/steamgame-vultr-setup
ssh root@YOUR_IP
cd /root/steamgame-vultr-setup && bash setup.sh
```

在 `/opt/steamgame-data/.env` 增加（或 setup 自动生成）：

```env
DATA_API_SECRET=长随机字符串
```

启动含 data-api 的 compose：

```bash
cd /opt/steamgame-data
docker compose up -d --build
docker compose ps
curl -s http://127.0.0.1:8090/health
```

开放端口：**22**、**9000**（MinIO）、**6379**（Redis）、**8090**（SQLite Data API，仅 Cloud Run 来源 IP）。

## 2. `server/.env`

```env
DATA_STORE=vultr_sqlite
SQLITE_API_URL=http://YOUR_VULTR_IP:8090
SQLITE_API_SECRET=<与 Vultr .env 中 DATA_API_SECRET 一致>
CACHE_UPLOAD_BACKEND=s3
DISCOUNT_OFFERS_PERSISTENCE=object_storage
S3_ENDPOINT=http://YOUR_VULTR_IP:9000
S3_ACCESS_KEY_ID=steamminio
S3_SECRET_ACCESS_KEY=...
S3_BUCKET=steamgame
PUBLIC_CACHE_CDN_BASE=http://YOUR_VULTR_IP:9000/steamgame
REDIS_URL=redis://:PASSWORD@YOUR_VULTR_IP:6379
BACKGROUND_WORKERS_ENABLED=true
REQUEST_LOG_ENABLED=false
```

## 3. 从 Firestore 迁移配置（一次性，不含游戏目录）

迁移：**用户、国家配置、折扣 API 配置、运行时配置、计划任务、Steam 资料/缓存**。  
**不迁移** `game_catalog` / 折扣分桶等游戏数据（表结构已建好，由 Steam 同步任务写入）。

```bash
cd server
set GOOGLE_APPLICATION_CREDENTIALS=你的服务账号.json
set SQLITE_API_URL=http://YOUR_VULTR_IP:8090
set SQLITE_API_SECRET=与 Vultr 一致
npx ts-node scripts/migrate-config-to-sqlite.ts
```

**本机 gRPC 被墙时**（`oauth2.googleapis.com` / Firestore gRPC 超时），用 REST 脚本（需 `gcloud auth login`）：

```powershell
$env:FIRESTORE_ACCESS_TOKEN = (gcloud auth print-access-token).Trim()
$env:SQLITE_API_URL = "http://YOUR_VULTR_IP:8090"
$env:SQLITE_API_SECRET = "与 Vultr 一致"
py -3 server/scripts/migrate-config-rest.py
```

完成后 `DATA_STORE=vultr_sqlite` 并部署 Cloud Run。

## 4. 存储分工（不再使用 Firestore / GCS）

| 类型 | 位置 |
|------|------|
| 用户、配置、国家、Steam、游戏目录、视频元数据、收藏 | **SQLite**（`schema.sql` 各表） |
| 折扣 JSON、公开 cache、视频文件 | **MinIO**（`CACHE_UPLOAD_BACKEND=s3`） |
| 短缓存、今日已同步索引 | **Redis** |

`DATA_STORE=vultr_sqlite` 时服务端通过 **Firestore 兼容层** 将 `game_catalog` 等集合写入对应 SQLite 表（非单一 `documents` 桶）。

## 5. 部署 Cloud Run

```powershell
.\scripts\deploy-cloud-run.ps1
```

## 5b. 将 API + Admin 部署到同一台 Vultr（与数据层同机）

数据层已在 `/opt/steamgame-data`（Redis + MinIO + data-api）时，在**本机**执行：

```powershell
.\scripts\deploy-vultr-api.ps1 -Password '你的root密码'
# 或: $env:VULTR_SSH_PASSWORD='...'; .\scripts\deploy-vultr-api.ps1
```

- API 容器目录：`/opt/steamgame-api`
- 对外：**http://YOUR_IP:8080/**（Admin）、**http://YOUR_IP:8080/health**
- 容器内通过 Docker 网络访问 `data-api` / `minio` / `redis`（无需经公网回环）
- 1GB 内存 VPS：API 容器限制约 480MB，`NODE_OPTIONS=--max-old-space-size=320`

重新部署（改代码后）再次运行同一脚本即可。

## 6. 降本检查

- GCP Console → Firestore：**无新读写的增长**（迁移后 API 不再连接）
- 仍产生费用的常见项：Cloud Run 实例、出站流量到 Vultr、若未删旧的 GCS 桶

## 回退 Firestore

```env
DATA_STORE=firestore
FIREBASE_PROJECT_ID=steamdeal
```

并配置 `GOOGLE_APPLICATION_CREDENTIALS` 或 Cloud Run 服务账号。
