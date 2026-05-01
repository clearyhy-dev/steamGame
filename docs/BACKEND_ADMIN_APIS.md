# Backend 管理接口总表（单服务）

本文档记录当前项目后端管理接口、用途、调用建议，以及为何会出现两个 Cloud Run 服务。

## 1. 当前部署结论

- 已完成统一部署到：`steam-game-api`（region: `asia-southeast1`）
- 最新 revision：`steam-game-api-00025-tq8`
- 当前服务 URL：`https://steam-game-api-r7vmg7elga-as.a.run.app`

> 管理后台页面入口：`/admin/`  
> 管理 API 前缀：`/api/admin`

---

## 2. 为什么你会看到两个 gcloud 服务

当前 project `steamdeal` 下已统一为：

- `steam-game-api`（asia-southeast1）

出现两个服务的原因通常是：

1. 历史上在不同 region 各部署过一次；
2. 服务名不同（`steam-game-api` vs `steamdeal-api`），Cloud Run 会视为两个独立服务；
3. 某次使用了 `server/` 或根目录不同部署入口，导致新建了不同服务名。

### 处理结果（本次已执行）

- 旧服务 `steamdeal-api`（us-central1）已删除；
- 线上只保留 `steam-game-api`；
- App 默认 `API_BASE_URL`、后端回调域名已统一到同一服务域名。

---

## 3. 管理接口鉴权

- 登录接口：`POST /api/admin/auth/login`
- 其余 `/api/admin/*` 接口都走 Admin JWT 鉴权（`Authorization: Bearer <token>`）

---

## 4. 管理接口清单（含作用）

以下路径均相对于 `/api/admin`。

## 4.1 认证与仪表盘

- `POST /auth/login`
  - 作用：管理员登录，签发 admin token
- `GET /auth/me`
  - 作用：校验当前 token 并返回管理员身份
- `POST /auth/logout`
  - 作用：后台登出（客户端清 token）
- `GET /dashboard/stats`
  - 作用：读取视频/任务总览统计

## 4.2 视频来源管理

- `GET /video-sources`
  - 作用：分页/筛选视频来源列表
- `POST /video-sources/youtube`
  - 作用：创建 YouTube 来源
- `POST /video-sources/steam`
  - 作用：创建 Steam 来源
- `PATCH /video-sources/:sourceId`
  - 作用：更新来源配置（优先级、启停、标题等）
- `POST /video-sources/:sourceId/ingest`
  - 作用：手动触发该来源入库采集
- `GET /video-sources/:sourceId`
  - 作用：查看来源详情

## 4.3 视频管理

- `GET /videos`
  - 作用：视频列表查询
- `GET /videos/:videoId`
  - 作用：视频详情
- `POST /videos/:videoId/publish`
  - 作用：发布视频
- `POST /videos/:videoId/unpublish`
  - 作用：取消发布
- `POST /videos/:videoId/reprocess`
  - 作用：重新处理视频任务（转码/封装）

## 4.4 视频任务管理

- `GET /video-jobs`
  - 作用：查看任务队列与状态
- `POST /video-jobs/:jobId/retry`
  - 作用：重试失败任务

## 4.5 Steam 用户游戏缓存管理（按用户）

- `GET /steam-games`
  - 作用：查看按用户缓存的 owned/recent game（运营排查用）
- `POST /steam-users/:steamId/sync`
  - 作用：手动同步某个 Steam 用户资料/好友/游戏缓存

## 4.6 游戏主数据管理（核心）

- `GET /games`
  - 作用：后台游戏列表；支持 `appid/name/discount_percent/has_deal_link` 筛选
- `GET /games/:appid`
  - 作用：游戏详情（含 deal links、bestDeal、评论、关联视频）
- `PATCH /games/:appid`
  - 作用：手动更新单游戏 `discountUrl`（兼容旧逻辑）

### Steam 同步

- `POST /games/sync-app-list`
  - 作用：从 `ISteamApps/GetAppList/v2/` 批量导入 appid+name，去重/跳过重复
- `POST /games/:appid/sync-detail`
  - 作用：同步单个 app 详情（封面、描述、开发商、发行商、分类、标签、价格、折扣等）
- `POST /games/sync-details`
  - 作用：批量同步详情（每次 100~500；失败不中断整批）
- `GET /games/sync-jobs`
  - 作用：查看 Steam 同步任务执行记录（manual/worker，成功失败与耗时）

### 元信息与评论

- `POST /games/:appid/sync-meta`
  - 作用：同步图片、trailer、基础元信息（含兼容逻辑）
- `POST /games/:appid/load-reviews`
  - 作用：拉取并保存 Steam 评论与摘要

### Deal Links 管理

- `GET /games/:appid/deal-links`
  - 作用：读取某游戏全部 deal links
- `POST /games/:appid/deal-links`
  - 作用：新增 deal link（source/url/priority/isActive/startAt/endAt）
- `PATCH /games/:appid/deal-links/:dealId`
  - 作用：更新 deal link（启停、优先级、时间窗、affiliate）

## 4.7 用户管理

- `GET /users`
  - 作用：后台用户列表查询（provider/keyword）
- `PATCH /users/:userId`
  - 作用：更新用户状态与运营字段

---

## 5. 购买入口 best deal 逻辑（当前生效）

App 查询：`GET /api/games/:appid/discount-link`

返回策略：

1. 若存在 active affiliate link：优先返回 affiliate
2. 若无 affiliate 但 Steam 有折扣：返回 Steam 折扣链接
3. 若都没有：返回普通 Steam Store 链接

---

## 6. 自动同步与日志

- 自动任务由 `steam-sync.worker` 执行（可通过 env 开关）
- 任务执行会写入集合：`steam_sync_jobs`
- 点击事件 `v1/events/click` 会聚合到 `game_catalog.clickCount`
- 所有同步批次采用“单条失败不中断整批”

---

## 7. 推荐的单服务运维约束

- 仅维护 `steam-game-api` 一个 Cloud Run 服务
- 统一域名变量：
  - `APP_BASE_URL`
  - `STEAM_REALM`
  - `STEAM_RETURN_URL`
- `SERVE_ADMIN_STATIC=true`，保证 `/admin` 可直接访问
- 管理密钥和 Steam key 建议迁移到 Secret Manager

