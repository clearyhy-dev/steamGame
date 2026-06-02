# Steam Deal Alert

一个以 **Steam 折扣/区域价/推荐** 为核心的 Flutter App + Cloud Run 后端 + Firestore 的全栈项目。

本 README 作为**索引页**：从总体架构、App 端功能、接口与数据流、后端服务职责，到待优化清单，都采用“引用文档”的方式组织，便于长期维护与审计。

---

## 总体架构（建议先读）

- **系统最终形态（架构/数据流/权限/订阅/广告/多语言）**：[docs/ARCHITECTURE_FINAL.md](docs/ARCHITECTURE_FINAL.md)
- **代码结构约束与模块边界**：[docs/STRUCTURE_FINAL.md](docs/STRUCTURE_FINAL.md)

## App 端功能概览

App 的核心页面与功能（对应代码 `lib/features/*`）：Home / Explore / Wishlist / Profile + Steam 子模块页（Steam overview / owned / recent / friends / favorites）。

更详细的网络与数据流，请直接读下节文档。

## App 调用的接口与数据来源（架构梳理）

Flutter App **不直连业务数据库**。数据来自：

- **自建后端 API**（Cloud Run 服务，后端再读 Firestore/缓存或调用第三方）
- **直连公网第三方**（CheapShark、Steam 商店、Steam Web API、IsThereAnyDeal）
- **Google/Firebase/Play**（登录、推送、埋点、应用内更新、内购/广告）
- **本地缓存/本地计算**（Storage/Cache、排序/打分/去重等）

完整接口清单、用途、是否经后端、与“读库”的对应关系、优化建议见：

- [docs/APP_NETWORK_ARCHITECTURE.md](docs/APP_NETWORK_ARCHITECTURE.md)

## 后端功能与服务职责

- **后端部署总览**：[docs/deployment.md](docs/deployment.md)
- **Cloud Run 细节与踩坑**：[docs/GCP_CLOUD_RUN.md](docs/GCP_CLOUD_RUN.md)
- **Steam 后端部署/回跳配置**：[docs/STEAM_BACKEND_DEPLOY.md](docs/STEAM_BACKEND_DEPLOY.md)
- **管理后台（Admin）功能说明**：[docs/ADMIN_DASHBOARD.md](docs/ADMIN_DASHBOARD.md)
- **管理端接口总表**：[docs/BACKEND_ADMIN_APIS.md](docs/BACKEND_ADMIN_APIS.md)

---

## 后端：缓存改造与存储分层（当前实现）

本节说明 **你现在用到的缓存是哪些**、**折扣/热度/评论如何落到对象存储**、以及 **Firestore 仍保留的原因**（全站不可能只靠进程内内存）。

### 「缓存」在你项目里指什么（按可靠性递增）

| 名称 | 实现 | 生命周期 | 典型用途 |
|------|------|----------|----------|
| **A. API 短缓存（cacheService）** | 未设 **`REDIS_URL`**：`node-cache`（进程内存）；已设 **`REDIS_URL`**：**Redis**（Upstash / Memorystore 等） | 内存：**部署即丢**。Redis：**TTL 内跨部署保留**（仍非业务真源，过期会没） | 国家列表、`/games/catalog`、`/games/search`、`/games/popular-searches` 等（默认 **600s**） |
| **B. 推荐 Map** | `recommendations.service.ts` 内 `Map` | 同上，约 **10 分钟** | `home` / `trending-public` / `explore` |
| **C. 运行时合并缓存** | `runtime-config.ts` | 约 **60s** | 进程内合并 `Env` + Firestore `system_config` |
| **D. HTTP Cache-Control** | `httpSafePublicCacheMiddleware` | CDN/浏览器按头 | 仅**白名单** GET、且无 `Authorization` 时生效 |
| **E. 对象存储 JSON（GCS/R2）** | `uploadPublicCacheJson`、`cache/discount-offers/v1/*.json` 等 | **跨实例、可每日整批覆盖**；适合「日更快照」 | 首页/榜单类静态拉取、可选 **`DISCOUNT_OFFERS_PERSISTENCE=object_storage`** 时作为折扣分桶**唯一落盘** |

**结论**：若目标是「每天刷新、少 Firestore Read、可运维删改」，**真正该当“缓存层真源”的是 E（对象存储 + CDN）**；A/B 只是削峰，**不能**替代磁盘级或桶级持久化。

### 重新部署后，哪些会丢、如何避免「像丢数据」

- **业务数据**（Firestore、GCS 桶里的 JSON）**不会因 Cloud Run 换版本而丢失**。  
- **进程内缓存**（未接 Redis 时的 `cacheService`、推荐的 `Map`、`runtime-config` 合并缓存）**会丢**：新实例冷启动后第一次请求会重新算/再读库，只是 **成本与延迟** 波动，不是删库。  
- **希望「API 层热点缓存」部署后仍在**：在 Cloud Run 配置 **`REDIS_URL`**（例如 [Upstash](https://upstash.com/) 的 HTTPS Redis URL，或 GCP Memorystore + VPC —— 后者需网络打通）。`cacheService` 会自动走 Redis，**键在 TTL 内跨部署可读回**。  
- **推荐接口的 `Map`** 目前仍在进程内，**部署仍会清空**；若也要跨部署，需再抽一层 Redis 或改为读静态 JSON/CDN。


- **默认 `DISCOUNT_OFFERS_PERSISTENCE=object_storage`（或未设置）**  
  折扣同步写入 **GCS/R2** `cache/discount-offers/v1/{appid}__{CC}.json`，**不落** Firestore `game_discount_offers`。

- **`DISCOUNT_OFFERS_PERSISTENCE=firestore`**（显式设置时）  
  与旧版一致，写入 **`game_discount_offers`**（Firestore）。

- **`object_storage` 还需**（R2 时另配 `CACHE_UPLOAD_BACKEND=r2` 与 `R2_*`）  
  - **读写** `GameDiscountOffersRepository` 走 **GCS/R2** 路径：`cache/discount-offers/v1/{appid}__{CC}.json`。  
  - **不再**对 `game_discount_offers` 做 merge/get/list（Firestore 该集合对此模式停用）。  
  - Admin 里依赖 Firestore 全表扫描的 **GG 发现**（`scanGgDiscoveryAgainstCatalog`）在 object_storage 下会返回空并打日志。  
  - **物理删除 / markStale / 清 invalid 片段** 等维护任务在 object_storage 下**跳过**；日更「删除」请用 **桶生命周期规则** 或运维脚本按前缀清理。

### 定时快照 `runCacheBuild` 写入的 `cache/*.json`（供 CDN）

除原有 `top-discounts-*`、`trending-games`、`hot-deals`、`*-prices`、`popular-searches` 外，另增：

| 文件 | 内容 |
|------|------|
| `cache/game-heat.json` | 目录侧热度镜像（当前来自 `game_catalog` 高在线列表，日更） |
| `cache/review-highlights.json` | 带 `reviewSummary` 的游戏摘要（日更；**读构建仍从 Firestore catalog 抽一次**写入桶） |

客户端优先：`PUBLIC_CACHE_CDN_BASE` + 相对路径（与 `GET /api/config` 下发一致）。

### 为什么「不全站取消 Firestore」

Firestore 仍适合 **强一致、事务、按用户/按文档索引** 的数据，例如：`users`、`user_favorites`、`system_config`、`game_catalog` 元数据、视频任务、请求日志等。  
**仅**将「高频、可日更、可整包替换」的块（折扣分桶、榜单快照、评论摘要镜像）迁到对象存储，是成本与复杂度之间的常见折中。

### 还适合统一进「日更对象存储 / CDN」的数据（架构师常用清单）

- 全站 **国家/币种/Steam 区映射** 的只读快照（已有 countries API + 可再出一份 JSON）  
- **推荐 feed** 的匿名兜底块（与 `trending-public` 同源池）  
- **排行榜 / 标签聚合** 等只读大盘  
- **SEO 落地页** 所需的结构化片段（若以后做 SSR 壳）

### 主要代码位置

| 用途 | 路径 |
|------|------|
| API 短缓存（node / Redis） | `server/src/cache/cacheService.ts` |
| 折扣分桶 GCS/R2 读写 | `server/src/cache/discount-offers-object-storage.ts` |
| 分桶 Repository（双模式） | `server/src/modules/game/game-discount-offers.repository.ts` |
| 上传抽象 GCS/R2 | `server/src/cache/cache-object-upload.ts` |
| 环境变量 `DISCOUNT_OFFERS_PERSISTENCE` | `server/src/config/env.ts` |
| 定时构建 + 热度/评论 JSON | `server/src/jobs/cacheBuilder.ts` |
| HTTP 缓存白名单 | `server/src/middlewares/httpCache.middleware.ts` |

### 已知缺口与建议调整（对照用）

1. **R2 纯写 + 部分 API 仍只从 GCS 拉**：例如 `popular-searches` 回源逻辑若未配 `publicCacheCdnBase`，需对齐 R2 Get 或强制 CDN 域名。  
2. **Cron 响应** `runCacheBuild` 使用 `target` + `backend` + `keys`。  
3. **搜索 cursor 语义** 与旧 `page` 不一致，客户端需对齐。  
4. **object_storage 下** Admin **GG 发现**、**按 Firestore 分页删折扣** 不可用；改用桶策略或离线作业。  
5. **热度/评论 JSON** 当前由 Job **读 Firestore catalog 一次**生成；若连这一步也要去掉 Firestore，需要上游（如 BigQuery / 另一任务）只写桶。  
6. **Flutter 文档** [docs/APP_NETWORK_ARCHITECTURE.md](docs/APP_NETWORK_ARCHITECTURE.md) 建议补充静态 `cache/*.json` 与 `DISCOUNT_OFFERS_PERSISTENCE`。

## 本地开发与打包

- **开发机/打包（D 盘缓存约束）**：[docs/README.md](docs/README.md)
- **Google Sign-In 配置**：[docs/GOOGLE_SIGNIN_SETUP.md](docs/GOOGLE_SIGNIN_SETUP.md)、[docs/GOOGLE_SIGNIN_CODE_AND_CHECKLIST.md](docs/GOOGLE_SIGNIN_CODE_AND_CHECKLIST.md)
- **通知排查**：[docs/NOTIFICATIONS_TROUBLESHOOTING.md](docs/NOTIFICATIONS_TROUBLESHOOTING.md)

---

## 优化清单（架构师视角，按优先级）

下面是“明确可落地”的改造方向，用于你快速定位系统问题与改造优先级（详细背景可在 [docs/APP_NETWORK_ARCHITECTURE.md](docs/APP_NETWORK_ARCHITECTURE.md) 对照接口与数据流）。
### P0（稳定性 / 可维护性优先）

- **统一网络层出口**：当前存在 `SteamBackendService` 与 `ApiClient` 双轨（baseUrl、超时、重试、错误映射不同），建议统一为一个底层 client + 统一拦截器/日志/超时策略。
- **统一 baseUrl 解析与配置来源**：`ApiConstants` 与 `AppConfig` 双常量 + `AppRemoteConfig` 动态覆盖，建议收敛为一个“最终 API 根地址”提供方，避免线上环境错配。
- **推荐/列表的数据模型一致性**：后端推荐 `score` 与客户端本地打分字段不一致易导致排序退化；建议定义稳定的“列表展示模型契约”（字段缺失的降级策略要可观测）。

### P1（成本 / 性能 / 体验）

- **减少直连第三方**：把 CheapShark/Steam/ITAD 的兜底与聚合逐步迁到 BFF（自建后端），提升可观测性与一致性，同时降低客户端网络差异带来的失败率。
- **ITAD key 与配额治理**：避免客户端持有 key；若必须保留，至少提供后端代理与缓存、速率限制与熔断。
- **缓存键标准化**：按 `country + language + authState` 明确缓存命中策略；对“跨日刷新”与“强制刷新”做统一入口。

### P2（增长 / 合规 / 安全）

- **事件/日志关联**：让客户端关键请求带 request-id（或 session-id）并在后端落日志，方便追踪“某个用户看到的推荐来自哪里/哪条降级路径”。（当前已有 `/v1/events/*` 可作为承载）
- **公开接口限流与滥用防护**：对匿名可访问的 `/api/games/*` 系列在网关层做 rate-limit 与缓存策略区分（匿名 vs 带 token）。
- **隐私与截图泄露策略统一**：SteamID/链接遮罩在各 Steam 页面保持一致（已有部分实现，建议统一策略层）。

> 关联的历史清单与想法：[docs/TODO_CHECKLIST.md](docs/TODO_CHECKLIST.md)、[docs/ITAD_OPTIMIZATION_IDEAS.md](docs/ITAD_OPTIMIZATION_IDEAS.md)、[docs/REGIONAL_HOTNESS.md](docs/REGIONAL_HOTNESS.md)
