# Steam Deal Alert

一个以 **Steam 折扣/区域价/推荐** 为核心的 Flutter App + Cloud Run 后端 + Firestore 的全栈项目。

本 README 作为**索引页**：从总体架构、App 端功能、接口与数据流、后端服务职责，到待优化清单，都采用“引用文档”的方式组织，便于长期维护与审计。

---

## 总体架构（建议先读）

- **系统最终形态（架构/数据流/权限/订阅/广告/多语言）**：`docs/ARCHITECTURE_FINAL.md`
- **代码结构约束与模块边界**：`docs/STRUCTURE_FINAL.md`

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

- `docs/APP_NETWORK_ARCHITECTURE.md`

## 后端功能与服务职责

- **后端部署总览**：`docs/deployment.md`
- **Cloud Run 细节与踩坑**：`docs/GCP_CLOUD_RUN.md`
- **Steam 后端部署/回跳配置**：`docs/STEAM_BACKEND_DEPLOY.md`
- **管理后台（Admin）功能说明**：`docs/ADMIN_DASHBOARD.md`
- **管理端接口总表**：`docs/BACKEND_ADMIN_APIS.md`

## 本地开发与打包

- **开发机/打包（D 盘缓存约束）**：`docs/README.md`
- **Google Sign-In 配置**：`docs/GOOGLE_SIGNIN_SETUP.md`、`docs/GOOGLE_SIGNIN_CODE_AND_CHECKLIST.md`
- **通知排查**：`docs/NOTIFICATIONS_TROUBLESHOOTING.md`

---

## 优化清单（架构师视角，按优先级）

下面是“明确可落地”的改造方向，用于你快速定位系统问题与改造优先级（详细背景可在 `docs/APP_NETWORK_ARCHITECTURE.md` 对照接口与数据流）。
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

> 关联的历史清单与想法：`docs/TODO_CHECKLIST.md`、`docs/ITAD_OPTIMIZATION_IDEAS.md`、`docs/REGIONAL_HOTNESS.md`
