# 客户端网络调用与数据流说明

本文档面向架构梳理：**Flutter App 调用了哪些网络能力、各自用途、数据来自哪里**（自建后端 / 直连公网 / 仅本地）。  
**重要**：移动 App **从不直连业务数据库**；凡标注「自建后端」的接口，由 Cloud Run 等服务访问 Firestore、缓存或再转发第三方 API。

- **默认 API 根地址**：`lib/core/constants/api_constants.dart` 的 `ApiConstants.baseUrl`（可用 `--dart-define=API_BASE_URL=...` 覆盖）。
- **另一路 Base URL**：`lib/core/config/app_config.dart` 的 `AppConfig.apiBaseUrl`（`SteamRepository` / `ApiClient` 使用，默认值与上通常一致）。
- **启动时动态覆盖**：`GET /api/config` → `AppRemoteConfig.resolveApiBase()` 可能把请求改到 `publicAppBaseUrl`（运营在服务端配置）。

---

## 一、自建后端 API（`SteamBackendService` + 少量独立 `http`）

实现主文件：`lib/services/steam_backend_service.dart`。  
鉴权：多数接口在 Header 中带 `Authorization: Bearer <steamBackendToken>`（`StorageService.getSteamBackendToken()`）；部分公开接口可无 Token。

> **数据性质说明**：下列路径由**你的后端**实现。后端通常从 **Firestore / 内存缓存** 读取已同步的数据，或在请求时 **调用 CheapShark、IsThereAnyDeal、Steam Web API** 等再返回。App 侧只感知 HTTP JSON，不区分后端内部是「读库」还是「实时拉第三方」。

| 方法 / 用途 | HTTP | 路径 | 典型作用 |
|-------------|------|------|----------|
| 区域详情（Steam 价 + 多来源 deals 聚合展示） | GET | `/api/v1/games/:appid/regional-detail` | 游戏详情页区域价、店铺摘要等 |
| Steam 区域店价格 | GET | `/api/v1/games/:appid/steam-price` | 区域 Steam 标价 |
| 当前用户 | GET | `/api/me` | 登录态、用户标识 |
| Steam 资料摘要 | GET | `/api/me/steam-profile` | 绑定 Steam 后的展示名等 |
| 应用内收藏列表 | GET | `/api/favorites` | 服务端收藏（与本地愿望单可并存逻辑） |
| 添加收藏 | POST | `/api/favorites` | 写服务端收藏 |
| 删除收藏 | DELETE | `/api/favorites/:appid` | 删除服务端收藏 |
| 触发 Steam 数据同步 | POST | `/api/steam/sync` | 让后端拉取/更新 Steam 侧缓存 |
| 登出（后端会话） | POST | `/auth/logout` | 失效服务端 JWT 等 |
| 拥有游戏 | GET | `/api/steam/games/owned` | Steam 库（后端缓存/代理） |
| 最近游玩 | GET | `/api/steam/games/recent` | 最近玩过 |
| 好友状态 | GET | `/api/steam/friends/status` | 好友列表与在线状态 |
| 愿望单决策（买/等/观望） | GET | `/v1/wishlist/decisions` | 愿望单 AI/规则建议展示 |
| 用户统计摘要 | GET | `/v1/stats/summary` | 首页 Steam 卡片、画像 |
| 分享卡片数据 | GET | `/v1/stats/share-card` | 分享用文案/数据 |
| 发现页 Tab 推荐 | GET | `/v1/recommendations/explore?tab=...` | `trending`/`for_you`/`deep`/`hidden`（需登录） |
| 首页推荐 | GET | `/v1/recommendations/home` | 首页推荐列表（需登录） |
| 公开趋势推荐 | GET | `/v1/recommendations/trending-public` | 未登录时与首页/发现同源池的公开列表 |
| 埋点镜像 | POST | `/v1/events/:path` | `AnalyticsService` 在有 Token 时上报（服务端可落库） |
| Steam 全览聚合 | GET | `/api/steam/overview` | Steam「全部信息」页 |
| 跳转购买链接 | GET | `/api/games/:appid/discount-link` | 联盟链/最优购买链 |
| 多来源 deals | GET | `/api/games/:appid/deals` | 详情页多店铺报价列表 |
| 确保元数据 | POST | `/api/games/:appid/ensure-meta` | 触发后端补全游戏元数据 |
| 刷新 deals | POST | `/api/games/:appid/refresh-deals` | 强制刷新报价缓存 |

**浏览器打开（非 JSON API，但指向后端）**

- **Steam OpenID 登录/绑定**：`{apiRoot}/auth/steam/start?...`（`profile_page.dart`、`steam_library_page.dart` 等通过 `url_launcher` 打开）。

---

## 二、`ApiClient` + `SteamApi`（同一后端，JWT 由 `AuthInterceptor` 注入）

- `lib/core/network/api_client.dart`：统一 `GET/POST/DELETE`，401 时清理 JWT。
- `lib/features/steam/data/steam_api.dart`：路径与上表 `/api/me`、`/api/favorites`、`/api/steam/*` 等**重复封装**，供 Steam 子模块 UI（好友/库/收藏页）使用。

**与 `SteamBackendService` 的关系**：两条客户端封装访问**同一套后端**，维护时注意避免行为漂移（超时、重试策略不一致等）。

---

## 三、自建后端 · 配置类（独立 `http.get`，通常无用户 Token）

| 模块 | 路径 | 作用 |
|------|------|------|
| `AppRemoteConfig` | `GET /api/config` | 超时、deeplink、国家列表 CSV、API 基址覆盖等 |
| `CountryCatalogService` | `GET /api/v1/config/countries` | 可选国家、货币、Steam cc、默认国别 |
| `ClientRegionClient` | `GET /v1/config/client-region` | 边缘/代理推断的访问国别 guess（可选） |

---

## 四、直连公网（不经过你的业务后端）

实现主文件：`lib/services/steam_api_service.dart`（及少量页面内 `Uri`）。

| 目标 | 基础 URL | 用途 |
|------|-----------|------|
| **CheapShark** | `https://www.cheapshark.com/api/1.0` | `deals` 列表、`deals?id=` 详情、`games?title=` 搜索；发现/首页在推荐失败时作兜底 |
| **Steam 商店** | `https://store.steampowered.com/api/appdetails` | 游戏名、头图、截图 |
| **Steam 商店评测** | `https://store.steampowered.com/appreviews/:appid` | 详情页社区评测列表与汇总 |
| **Steam Web API（公开）** | `https://api.steampowered.com/ISteamUserStats/GetNumberOfCurrentPlayers/v1/` | 当前在线人数 |
| **IsThereAnyDeal** | `https://api.isthereanydeal.com` | `v01/games/lookup`、`v01/game/history`（需 `AppConstants.itadApiKey`，无 key 则详情页价格历史走本地两点兜底） |

---

## 五、Google / Firebase 生态（终端直连 Google 基础设施）

| 能力 | 说明 |
|------|------|
| **Google Sign-In** | `AuthService`：账号与 profile，非你们 REST API |
| **Firebase Analytics** | `AnalyticsService`：事件上报；可选镜像到自建 `/v1/events/*` |
| **Firebase Cloud Messaging** | `FcmService`：推送令牌、收消息；令牌存本地 `StorageService` |
| **Google Play In-App Update** | `AppUpdateHelper`：检查更新（Google Play 服务） |
| **Google Play Billing** | 订阅/内购页面通过 `in_app_review` / 应用内购买相关包与 Play 商店通信（非你们 HTTP API） |
| **AdMob** | 广告 SDK 请求 Google 广告网络 |

---

## 六、仅本地 / 无 HTTP

| 能力 | 说明 |
|------|------|
| `StorageService` / `shared_preferences` | 用户 id、Token、愿望单、游戏列表缓存、远程配置缓存、国家目录缓存等 |
| `CacheService` | 按国家缓存游戏列表（常与后端推荐或 CheapShark 结果结合） |
| `CurrentPlayersCache` | 内存缓存在线人数，供打分与 UI |
| 本地化 | `AppLocalizations`：无网络 |

---

## 七、与「读数据库」的对应关系（概念层）

| 调用方式 | App 是否直连 DB | 数据通常来自 |
|----------|-----------------|--------------|
| 自建后端 JSON API | 否 | 后端读 Firestore / 缓存，或请求时再拉第三方 |
| CheapShark / Steam / ITAD | 否 | 第三方服务与各自存储 |
| Firebase / Play | 否 | Google 侧 |
| 本地缓存 | 是（仅本机） | 用户设备 |

---

## 八、架构优化建议（高级视角）

1. **统一 HTTP 出口**  
   合并 `SteamBackendService` 与 `ApiClient` 的 baseUrl 解析、超时、重试、日志，减少双轨维护与线上「一边成功一边失败」的差异。

2. **减少终端直连第三方**  
   CheapShark / Steam / ITAD 在客户端暴露会增加：密钥泄露面（ITAD key）、各市场网络差异、难以做全链路观测。长期可把「列表兜底、评测、人数」逐步迁到 **BFF**，App 只打自建域名。

3. **ITAD Key**  
   若必须保留客户端 ITAD：考虑 **仅后端代理** + 配额/缓存；客户端只拿匿名历史或后端裁剪后的序列。

4. **推荐与列表一致性**  
   首页/发现同时存在「后端推荐」与「CheapShark 兜底」，建议在文档与监控中明确 **降级路径** 与 **缓存键（国家+语言）**，避免排障时误判「推荐坏了」实为兜底数据。

5. **鉴权与公开接口**  
   对 `/api/games/*/deals` 等已支持匿名重试的接口，在网关层明确 **速率限制** 与 **滥用防护**，与带 Token 用户区分配额。

6. **可观测性**  
   客户端为关键路径打结构化日志（tab、country、language、数据来源：backend/cheapshark/cache），与后端 `request-log` 关联，便于对比「客户端以为的数据源」与「服务端实际」。

7. **Admin「App Games」**  
   管理后台 `GET /api/admin/games` 等 **仅运营使用**，App 永不调用；数据经运营同步进库后，由公开 `/api/games/*` 与推荐服务消费。

---

## 九、相关文档

- 后端部署：`docs/deployment.md`
- 管理端接口总表：`docs/BACKEND_ADMIN_APIS.md`（若存在）

本文档随代码演进应更新；修改网络层时请同步校正路径与类名。
