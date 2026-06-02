/**
 * 与 Express 路由对齐的接口目录；供 /v1/meta/endpoints、Swagger、Admin 诊断使用。
 * audience：谁在「正常业务」里主要调用该 HTTP（定时任务见 openapi info 中的 Worker 说明）。
 */

import type { EndpointRow } from './endpoint-types';

export type { EndpointRow } from './endpoint-types';
export type { EndpointAudience } from './endpoint-types';

/** 随 Node 进程启动的定时逻辑（无对外 REST 路径） */
export type BackgroundJobDoc = {
  id: string;
  name: string;
  trigger: string;
  purpose: string;
};

export function listBackgroundJobs(): BackgroundJobDoc[] {
  return [
    {
      id: 'video.worker',
      name: '视频转码/流水线 Worker',
      trigger: `循环间隔 = 运行时配置 videoWorkerIntervalMs（默认见 env）；轮询待处理 VideoJob。`,
      purpose: '拉取 pending 任务，执行 ffmpeg/上传等，更新任务状态；非 HTTP 触发。',
    },
    {
      id: 'steam-sync.worker',
      name: 'Steam 目录与详情同步 Worker',
      trigger:
        '仅当 steamAutoSyncEnabled=true；间隔 ≥ steamAutoSyncIntervalMs（且不低于 5 分钟）；启动后立即 tick 一次。',
      purpose: '拉取 Steam AppList、批量补全未同步游戏的商店详情写入目录库；与 Admin「手动同步」互补。',
    },
    {
      id: 'request-log-cleanup.worker',
      name: 'API 请求日志清理',
      trigger: '每 6 小时一次；启动后立即执行一次。',
      purpose: '按 requestLogRetentionDays 删除 api_request_logs 中过期记录。',
    },
  ];
}

export function listKnownEndpoints(): EndpointRow[] {
  const aliasNote =
    '（与 `/v1/...` 等价：路由同时挂在 `/api/v1` 与 `/v1` 下，任选其一即可。）';

  return [
    // ——— 运维 / 文档 ———
    {
      method: 'GET',
      path: '/health',
      authRequired: false,
      scope: 'app_public',
      audience: 'ops',
      name: '健康检查',
      usedBy: ['负载均衡/容器探针'],
      whenToCall: '编排系统按间隔探测服务是否存活时。',
      purpose: '返回简单 JSON；Cloud Run 勿使用 /healthz（平台保留路径）。',
    },
    {
      method: 'POST',
      path: '/api/internal/cron/build-cache',
      authRequired: false,
      scope: 'app_public',
      audience: 'ops',
      name: 'Cron: 构建 GCS 公开 JSON 缓存（cache/*.json）',
      usedBy: ['Cloud Scheduler', '运维脚本'],
      whenToCall:
        '定时（如每 1～6 小时）在构建完成后刷新 CDN 边缘快照；需配置 `CRON_SECRET` 与 `GCS_CACHE_BUCKET` 或 `VIDEO_GCS_BUCKET`。',
      purpose:
        '聚合目录/折扣快照写入 `cache/trending-games.json`、`cache/hot-deals.json` 等（默认 GCS；`CACHE_UPLOAD_BACKEND=r2` 时写 Cloudflare R2）。供客户端与 CDN 降源站/Firestore 读。Header：`X-Cron-Secret`。本地等价：`npm run cache:build`（server 目录）。',
      notes: '与 `/api/internal/cron/*` 相同：无 Bearer，凭 `X-Cron-Secret` 鉴权；响应非 Admin envelope。',
    },
    {
      method: 'GET',
      path: '/api/openapi.json',
      authRequired: false,
      scope: 'app_public',
      audience: 'ops',
      name: 'OpenAPI 3 原始 JSON',
      usedBy: ['Postman 导入', '网关', 'CI'],
      whenToCall: '需要机器可读的全量接口契约或流水线校验时。',
      purpose: '返回标准 OpenAPI 文档对象（非 envelope 包装）。',
    },
    {
      method: 'GET',
      path: '/api/docs',
      authRequired: false,
      scope: 'app_public',
      audience: 'ops',
      name: 'Swagger UI',
      usedBy: ['浏览器'],
      whenToCall: '人工查看或调试 REST 时浏览器打开。',
      purpose: '可视化展示 OpenAPI；静态交互界面。',
      notes: '实际由 swagger-ui-express 托管；method 视为 GET。',
    },

    // Client bootstrap / config
    {
      method: 'GET',
      path: '/api/config',
      authRequired: false,
      scope: 'app_public',
      audience: 'app',
      name: 'Client config (bootstrap)',
      usedBy: ['AppRemoteConfig.loadFromBackend'],
      whenToCall: 'App 冷启动或显式刷新远程配置时调用一次；非每个业务请求都拉取。',
      purpose:
        '返回公网根地址、超时、深链、Swagger 链接。**国家/语言/货币映射不在此重复**：客户端应使用 `GET /api/v1/config/countries` 的结构化列表并在本地推导（与 Admin Country / Steam 一致）。',
    },
    {
      method: 'GET',
      path: '/api/v1/config/countries',
      authRequired: false,
      scope: 'app_public',
      audience: 'app',
      name: 'Country catalog (enabled countries) + header region guess',
      usedBy: ['CountryCatalogService.load', 'AppCountryResolver'],
      whenToCall: '进入国家/地区相关流程前拉取一次；与旧接口整合，不再单独请求 client-region。',
      purpose:
        '返回启用国家列表、default/fallback、`clientRegionCountryCode`（边缘头推断），以及每国 **steamCc** 与 **ITAD / GG.deals / CheapShark** 用国别码（未配置时与 countryCode 一致；GG 为小写 ISO2）。',
      notes: '等价路径 `/v1/config/countries`（同路由挂载于 `/v1` 与 `/api/v1`）。',
    },

    // Auth
    {
      method: 'GET',
      path: '/auth/steam/start',
      authRequired: false,
      scope: 'app_public',
      audience: 'browser_oauth',
      name: 'Steam OpenID 登录起点',
      usedBy: ['WebView / 浏览器'],
      whenToCall: '用户在 App 内发起 Steam 绑定/登录，跳转到 Steam OpenID 前由服务端重定向。',
      purpose: '构造 Steam OpenID 请求并重定向到 Steam；浏览器会话。',
    },
    {
      method: 'GET',
      path: '/auth/steam/callback',
      authRequired: false,
      scope: 'app_public',
      audience: 'browser_oauth',
      name: 'Steam OpenID 回调',
      usedBy: ['Steam OpenID return_to'],
      whenToCall: 'Steam 授权完成后回调到此 URL；浏览器命中。',
      purpose: '校验 OpenID 响应，建立/关联会话或下发后续 Deep Link；具体流程见 AuthController。',
    },
    {
      method: 'POST',
      path: '/auth/steam/bind',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: '绑定 Steam 到当前账号',
      usedBy: ['Profile / Steam account'],
      whenToCall: '用户已完成 Google 登录且拿到 Steam identity 后提交绑定。',
      purpose: '把 Steam ID 写入用户档案；需 App JWT。',
    },
    {
      method: 'POST',
      path: '/auth/logout',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: '注销 App 会话',
      usedBy: ['App logout'],
      whenToCall: '用户退出登录时。',
      purpose: '作废或清理服务端会话/JWT 黑名单策略（依实现）；需 Bearer。',
    },

    // Users
    {
      method: 'GET',
      path: '/api/me',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: '当前用户信息',
      usedBy: ['App shell', 'Profile'],
      whenToCall: '启动后校验 JWT、刷新个人资料卡片时。',
      purpose: '返回当前登录用户的基础资料与 ids。',
    },
    {
      method: 'GET',
      path: '/api/me/steam-profile',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: '当前用户 Steam 档案摘要',
      usedBy: ['Profile', 'Steam sections'],
      whenToCall: '需要展示绑定 Steam 公开资料摘要时。',
      purpose: '返回与本账号关联的 Steam 展示字段（若未绑定可能为空）。',
    },

    // Steam API + v1 aliases
    {
      method: 'POST',
      path: '/api/steam/sync',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'Request Steam sync',
      usedBy: ['SteamOverviewPage / SteamAccountPage'],
      whenToCall: '用户绑定 Steam 后首次进入资料/Steam 汇总页，或手动下拉刷新触发后台同步任务时。',
      purpose: '触发服务端拉取/更新 Steam Web API 数据并写入缓存或队列，减少客户端直连 Steam 的频率。',
    },
    {
      method: 'GET',
      path: '/api/steam/overview',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'Steam overview (aggregated)',
      usedBy: ['SteamOverviewPage'],
      whenToCall: '打开「Steam 全部信息 / 概览」页或刷新该页时。',
      purpose: '返回汇总后的档案与统计摘要（头像、等级、库存摘要等，以后端聚合为准）。',
    },
    {
      method: 'GET',
      path: '/api/steam/games/owned',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'Steam owned games (cached/aggregated)',
      usedBy: ['SteamOwnedGamesPage'],
      whenToCall: '进入「我的游戏」列表或搜索库存时；可分页或带缓存刷新。',
      purpose: '返回拥有游戏列表（服务端缓存/聚合），避免客户端直连 Steam 大量分页请求。',
    },
    {
      method: 'GET',
      path: '/api/steam/games/recent',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'Steam recent games (cached/aggregated)',
      usedBy: ['SteamRecentGamesPage'],
      whenToCall: '进入「最近游玩」页或下拉刷新时。',
      purpose: '返回近期游玩记录及时长（聚合缓存），用于展示最近活跃。',
    },
    {
      method: 'GET',
      path: '/api/steam/friends',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'Steam friends list',
      usedBy: ['SteamFriendsPage'],
      whenToCall: '进入好友列表（展示头像与名称）时。',
      purpose: '返回好友基础列表；隐私隐藏时可能为空。',
    },
    {
      method: 'GET',
      path: '/api/steam/friends/status',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'Steam friends status (cached/aggregated)',
      usedBy: ['SteamFriendsPage'],
      whenToCall: '进入「好友」页或刷新在线状态时。',
      purpose: '返回好友在线/游戏中状态摘要；若 Steam 隐私限制则可能为空或受限提示。',
    },
    {
      method: 'GET',
      path: '/v1/steam/me',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'v1 alias: current user (same as /api/me)',
      usedBy: ['Legacy clients'],
      whenToCall: '与 `/api/me` 相同；走 v1 命名空间的客户端。',
      purpose: '委托 UsersController.me。',
      notes: aliasNote,
    },
    {
      method: 'GET',
      path: '/v1/steam/library',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'v1 alias: owned games (same as /api/steam/games/owned)',
      usedBy: ['Legacy clients'],
      whenToCall: '与 `/api/steam/games/owned` 相同。',
      purpose: '委托 SteamController.gamesOwned。',
      notes: aliasNote,
    },
    {
      method: 'GET',
      path: '/v1/steam/recently-played',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'v1 alias: recent games',
      usedBy: ['Legacy clients'],
      whenToCall: '与 `/api/steam/games/recent` 相同。',
      purpose: '委托 SteamController.gamesRecent。',
      notes: aliasNote,
    },

    // Favorites
    {
      method: 'GET',
      path: '/api/favorites',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'List favorites',
      usedBy: ['SteamFavoritesPage / repository'],
      whenToCall: '打开「收藏」页或需要从服务端同步收藏列表时。',
      purpose: '读取当前用户在后端持久化的收藏 AppId 列表，多端一致。',
    },
    {
      method: 'POST',
      path: '/api/favorites',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'Add favorite',
      usedBy: ['SteamOwnedGamesPage addFavorite'],
      whenToCall: '用户在库存或详情中点击「加入收藏」成功回调时。',
      purpose: '写入一条收藏记录，与本地乐观 UI 配合以保证云端为准。',
    },
    {
      method: 'DELETE',
      path: '/api/favorites/:appid',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'Remove favorite',
      usedBy: ['SteamFavoritesPage removeFavorite'],
      whenToCall: '用户在收藏列表或详情中移除某游戏时。',
      purpose: '按 AppId 删除收藏。',
    },

    // Wishlist
    {
      method: 'GET',
      path: '/api/v1/wishlist/decisions',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'Wishlist decisions',
      usedBy: ['Wishlist UI'],
      whenToCall: '需要展示「愿望单/决策」类服务端状态时。',
      purpose: '返回与用户愿望单相关的后端决策/标记数据（具体字段以后端实现为准）。',
      notes: aliasNote,
    },

    // Recommendations
    {
      method: 'GET',
      path: '/v1/recommendations/home',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'Home recommendations',
      usedBy: ['Home / Explore bootstrap'],
      whenToCall: '首页或「发现」首屏需要服务端个性化推荐列表时；登录后可用 JWT。',
      purpose: '聚合后端推荐管道（含品类、折扣、偏好等）生成首页卡片数据；客户端可做缓存与下拉刷新。',
    },
    {
      method: 'GET',
      path: '/v1/recommendations/explore?tab=trending|for_you|deep|hidden',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'Explore tab recommendations',
      usedBy: ['ExplorePage._loadExploreTab'],
      whenToCall: '用户在「发现」页切换 Tab（如 trending / for_you）或下拉刷新对应分区时。',
      purpose: '按 tab 返回细分推荐列表；query tab 区分不同运营策略或算法分支。',
    },
    {
      method: 'GET',
      path: '/v1/recommendations/trending-public',
      authRequired: false,
      scope: 'app_public',
      audience: 'public',
      name: 'Trending public recommendations (no auth)',
      usedBy: ['ExplorePage._load fallback'],
      whenToCall: '未登录或私人推荐接口失败时作为兜底，用于仍能展示公开热门内容。',
      purpose: '无需 Bearer 的公开热门榜，保证游客模式下的发现页可用性。',
      notes:
        'App 若已配置 `publicCacheCdnBase`（见 GET `/api/config`），可先请求 `…/cache/trending-games.json`，失败再调本接口。HTTP `Cache-Control` 仅对 allowlist 公开 GET 生效（本路径 30m）。',
    },

    // Games (public, canonical /api/v1)
    {
      method: 'GET',
      path: '/api/v1/games/catalog',
      authRequired: false,
      scope: 'app_public',
      audience: 'app',
      name: 'Game catalog cursor page',
      usedBy: ['List / browse'],
      whenToCall: '公开列表分页浏览游戏目录时。',
      purpose: '按 appid 游标分页（默认 limit=20，最大 50），避免无界扫描；配合内存短缓存削峰。',
      notes:
        `${aliasNote} Query：\`cursor\`（上一页末条 appid，首页省略）、\`limit\`（默认 20，最大 50）。HTTP \`Cache-Control\`：\`max-age=600\` + \`stale-while-revalidate=600\`（与 Node 键 \`games:catalog:*\` TTL 一致）。`,
    },
    {
      method: 'GET',
      path: '/api/v1/games/search',
      authRequired: false,
      scope: 'app_public',
      audience: 'app',
      name: 'Game catalog keyword search',
      usedBy: ['Search'],
      whenToCall: '按名称或 appid 片段搜索时。',
      purpose:
        'query `q` + **游标**分页（与 catalog 一致）；内存键 `games:search:${q}:${cursor}:${limit}`，TTL 600s，降低重复扫描。',
      notes:
        `${aliasNote} Query：\`q\`（≥2 字符）、\`cursor\`（上一页 \`nextCursor\`，首页省略）、\`limit\`（默认 20，最大 50）。HTTP 缓存：\`max-age=600\` + \`stale-while-revalidate=300\`。`,
    },
    {
      method: 'GET',
      path: '/api/v1/games/popular-searches',
      authRequired: false,
      scope: 'app_public',
      audience: 'app',
      name: 'Popular search phrases',
      usedBy: ['Search UI', 'Discover'],
      whenToCall: '搜索框热词/推荐 query 展示时。',
      purpose:
        '与定时任务写入的 `cache/popular-searches.json` 对齐：优先经 `publicCacheCdnBase` 拉 CDN，其次 GCS 直读，最后兜底词表；响应短时内存缓存。',
      notes: aliasNote,
    },
    {
      method: 'GET',
      path: '/api/v1/games/:appid/regional-detail',
      authRequired: false,
      scope: 'app_public',
      audience: 'app',
      name: 'Game regional detail (Steam formatted + deals)',
      usedBy: ['GameDetailPage'],
      whenToCall: '游戏详情页需要展示分区域价格、商店摘要、折扣线索等完整一块数据时。',
      purpose:
        '后端整合 Steam 区域信息与多渠道 deals，供详情页主展示；减少客户端多次拼装。默认仅拉 **当前国 + US** 的 `game_discount_offers` 分桶；全量多国需 `?fullByCountry=1`（`true`/`yes` 亦可）。响应含 `byCountry` 与 `countryPriceBucket`（可含 ITAD `itadDetail`、`worthBuy` 等，需先跑折扣同步）。',
      notes: `${aliasNote} Query：\`country\`、\`language\` / \`l\`、\`fullByCountry\`。`,
    },
    {
      method: 'GET',
      path: '/api/v1/games/:appid/steam-price',
      authRequired: false,
      scope: 'app_public',
      audience: 'app',
      name: 'Steam regional store price',
      usedBy: ['regional pricing'],
      whenToCall: '仅需 Steam 商店原价/现价等轻量价格片段时（列表或卡片补全）。',
      purpose: '返回格式化后的区域价格信息，供 UI 展示或与其它价格源比对。',
      notes: aliasNote,
    },
    {
      method: 'GET',
      path: '/api/games/:appid/deals',
      authRequired: false,
      scope: 'app_public',
      audience: 'public',
      name: 'Deals list (multi-source)',
      usedBy: ['GameDetailPage'],
      notes: 'May retry anonymously if auth call fails',
      whenToCall: '详情页「优惠/渠道」区域加载或手动刷新报价列表时。',
      purpose: '聚合多来源 deals（键商、比价站等）返回列表；失败时客户端可能匿名重试。',
    },
    {
      method: 'GET',
      path: '/api/games/:appid/discount-link',
      authRequired: false,
      scope: 'app_public',
      audience: 'public',
      name: 'Best discount link (affiliate)',
      usedBy: ['GameDetailPage buy button'],
      whenToCall: '用户点击「购买/跳转」按钮前获取当前最优跳转链接时。',
      purpose: '返回带联盟或追踪参数的最佳购买链接，便于统计与合规跳转。',
    },
    {
      method: 'POST',
      path: '/api/games/:appid/ensure-meta',
      authRequired: true,
      scope: 'app_backend',
      audience: 'mixed',
      name: 'Ensure game metadata',
      usedBy: ['Detail prefetch', 'Admin 调试可选'],
      whenToCall: '进入详情前发现本地缺元数据，或运营预拉取某 App 时。',
      purpose: '在后端创建/补全游戏元数据缓存（标题、头图等），避免详情空白。',
    },
    {
      method: 'POST',
      path: '/api/games/:appid/refresh-deals',
      authRequired: true,
      scope: 'app_backend',
      audience: 'mixed',
      name: 'Refresh deals cache',
      usedBy: ['Admin / debug', '可选 App 调试入口'],
      whenToCall: '管理端或调试强制刷新某游戏 deals 缓存时。',
      purpose: '绕过常规 TTL，触发后端重新抓取并写入缓存。',
    },

    // Videos (public)
    {
      method: 'GET',
      path: '/api/videos',
      authRequired: false,
      scope: 'app_public',
      audience: 'public',
      name: 'List public videos',
      usedBy: ['App video gallery', 'Web'],
      whenToCall: '展示公开视频列表或首页嵌入区块加载时。',
      purpose: '分页返回已发布视频条目（不含敏感后台字段）。',
    },
    {
      method: 'GET',
      path: '/api/videos/:videoId',
      authRequired: false,
      scope: 'app_public',
      audience: 'public',
      name: 'Get public video detail',
      usedBy: ['Video detail'],
      whenToCall: '点击某一公开视频查看详情时。',
      purpose: '返回元数据与播放所需公开信息。',
    },
    {
      method: 'GET',
      path: '/api/videos/:videoId/playback',
      authRequired: false,
      scope: 'app_public',
      audience: 'public',
      name: 'Playback URL / token hints',
      usedBy: ['Video player'],
      whenToCall: '播放器启动前获取可播放地址或签名参数时。',
      purpose: '返回临时播放授权或跳转 CDN 所需参数（依实现）。',
    },

    // Stats / share
    {
      method: 'GET',
      path: '/v1/stats/summary',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'Stats summary',
      usedBy: ['Home/Profile'],
      whenToCall: '首页或个人中心需要展示用户维度统计摘要（时长、收藏数等）时。',
      purpose: '返回后端汇总后的统计 JSON，供文案与卡片组件绑定。',
    },
    {
      method: 'GET',
      path: '/v1/stats/share-card',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'Share card',
      usedBy: ['Profile share card'],
      whenToCall: '用户生成或预览「分享卡片」、截图分享前拉取素材数据时。',
      purpose: '返回用于生成分享图/链接的字段（标题、背景、统计亮点等）。',
    },

    // Events (analytics)
    {
      method: 'POST',
      path: '/v1/events/exposure',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'Analytics: exposure',
      usedBy: ['Analytics SDK'],
      whenToCall: '曝光埋点：列表卡片进入可视区域或停留满足策略时上报。',
      purpose: '写入曝光事件用于漏斗与推荐评估。',
      notes: aliasNote,
    },
    {
      method: 'POST',
      path: '/v1/events/click',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'Analytics: click',
      usedBy: ['Analytics SDK'],
      whenToCall: '点击埋点：用户点击关键按钮或卡片时。',
      purpose: '写入点击事件。',
      notes: aliasNote,
    },
    {
      method: 'POST',
      path: '/v1/events/conversion',
      authRequired: true,
      scope: 'app_backend',
      audience: 'app',
      name: 'Analytics: conversion',
      usedBy: ['Analytics SDK'],
      whenToCall: '转化埋点：如下载、购买意向、深度链接成功等。',
      purpose: '写入转化事件。',
      notes: aliasNote,
    },

    // Meta (public diagnostics — not Admin envelope)
    {
      method: 'GET',
      path: '/v1/meta/endpoints',
      authRequired: false,
      scope: 'app_public',
      audience: 'mixed',
      name: 'Known endpoints listing (public JSON)',
      usedBy: ['脚本', '外部文档生成'],
      whenToCall: '需要无需 Admin 权限拉一份路由清单时（公开）。',
      purpose: '返回与本文档同源的结构化 endpoints 数组；与 Admin `/api/admin/meta/endpoints` 权限模型不同。',
      notes: aliasNote,
    },
    {
      method: 'GET',
      path: '/v1/meta/openapi.json',
      authRequired: false,
      scope: 'app_public',
      audience: 'ops',
      name: 'OpenAPI JSON (v1 meta mirror)',
      usedBy: ['工具链'],
      whenToCall: '与 `/api/openapi.json` 相同用途；经 v1/meta 挂载的镜像。',
      purpose: '返回标准 OpenAPI JSON。',
      notes: aliasNote,
    },

    // ——— Admin API（/api/admin） ———
    ...adminCatalog(),
    ...thirdPartyCatalog(),
  ];
}

function thirdPartyCatalog(): EndpointRow[] {
  return [
    {
      method: 'GET',
      path: 'https://www.cheapshark.com/api/1.0/*',
      authRequired: false,
      scope: 'third_party',
      audience: 'app',
      name: 'CheapShark public API',
      usedBy: ['SteamApiService'],
      whenToCall: '客户端需要补充第三方比价/促销列表、且走后端成本过高或直接对接公网时。',
      purpose: '公开只读 API；文档中标注为 App 可能直连，便于理解流量路径。',
    },
    {
      method: 'GET',
      path: 'https://store.steampowered.com/*',
      authRequired: false,
      scope: 'third_party',
      audience: 'app',
      name: 'Steam store (appdetails/appreviews)',
      usedBy: ['SteamApiService'],
      whenToCall: '需要 Steam 商店详情、评测、当前在线人数等官方接口且客户端直连时。',
      purpose: '标注为第三方公网源；注意频率与区域限制。',
    },
    {
      method: 'GET',
      path: 'https://api.isthereanydeal.com/*',
      authRequired: false,
      scope: 'third_party',
      audience: 'app',
      name: 'IsThereAnyDeal',
      usedBy: ['SteamApiService.fetchPriceHistoryFromItad'],
      whenToCall: '详情或图表需要历史低价、价格曲线而调用 ITAD 时。',
      purpose: '第三方比价 API；密钥通常在客户端或后端配置，文档仅说明依赖关系。',
    },
  ];
}

function adminCatalog(): EndpointRow[] {
  const ad = (
    method: EndpointRow['method'],
    path: string,
    name: string,
    extra: Partial<EndpointRow> & Pick<EndpointRow, 'whenToCall' | 'purpose'>,
  ): EndpointRow => ({
    method,
    path,
    authRequired: path === '/api/admin/auth/login' ? false : true,
    scope: 'admin',
    audience: 'admin',
    name,
    usedBy: ['Admin SPA'],
    ...extra,
  });

  return [
    ad('POST', '/api/admin/auth/login', 'Admin 登录', {
      whenToCall: '运营在浏览器打开后台并提交账号密码时。',
      purpose: '校验 Admin 凭证并签发 Admin JWT（与 App 用户 JWT 分离）。',
    }),
    ad('GET', '/api/admin/auth/me', '当前 Admin 用户', {
      whenToCall: '后台路由守卫校验会话或展示右上角账号时。',
      purpose: '返回当前 Admin 用户名（需 Admin JWT）。',
    }),
    ad('POST', '/api/admin/auth/logout', 'Admin 注销', {
      whenToCall: '管理员退出登录时。',
      purpose: '失效会话或客户端丢弃 Token（依实现）。',
    }),
    ad('GET', '/api/admin/dashboard/stats', '仪表盘聚合统计', {
      whenToCall: '打开后台首页时。',
      purpose: '视频任务、Steam 同步等汇总数字。',
    }),
    ad('GET', '/api/admin/request-logs', '请求日志查询', {
      whenToCall: '排查线上 API 问题、按用户/路径过滤时。',
      purpose: '分页返回 api_request_logs 记录。',
    }),
    ad('GET', '/api/admin/meta/endpoints', '路由清单（Admin 封装）', {
      whenToCall: '「App Diagnostics」页加载时。',
      purpose: '与公开 `/v1/meta/endpoints` 数据类似，但走 Admin 统一 envelope。',
    }),
    ad('GET', '/api/admin/settings/discount-providers', '读取折扣渠道配置', {
      whenToCall: '打开「折扣渠道」设置 Tab 时。',
      purpose: '返回 ITAD/GG/CheapShark/Steam 等 Key 与 Base URL（敏感字段按前端策略脱敏）。',
    }),
    ad('PATCH', '/api/admin/settings/discount-providers', '更新折扣渠道配置', {
      whenToCall: '保存折扣渠道表单时。',
      purpose: '写入 Firestore discount_providers。',
    }),
    ad('GET', '/api/admin/settings/runtime', '读取运行时配置', {
      whenToCall: '打开「运行时/App」设置 Tab 时。',
      purpose: '返回 effective + stored + 文档链接解析结果。',
    }),
    ad('PATCH', '/api/admin/settings/runtime', '更新运行时配置', {
      whenToCall: '保存 APP_BASE_URL、Steam Key、视频路径等时。',
      purpose: '合并写入 Firestore runtime；触发配置缓存失效。',
    }),
    ad('GET', '/api/admin/region-countries/provider-meta', '比价平台国别元数据', {
      whenToCall: '打开 Country/Steam 配置页时。',
      purpose: '返回 GG.deals region 建议列表、CheapShark 固定 US 等说明（与 catalog 同源）。',
    }),
    ad('GET', '/api/admin/region-countries', '区域国家列表', {
      whenToCall: '维护区域/国家启用状态时。',
      purpose: '返回国家启用、默认货币/语言等。',
    }),
    ad('POST', '/api/admin/region-countries', '新增/更新区域国家', {
      whenToCall: '运营保存某国家配置时。',
      purpose: '写入 Firestore `region_country_configs`（含 steamCc 与 ITAD/GG/CheapShark 国别）。',
    }),
    ad('POST', '/api/admin/region-countries/sync-provider-codes', '回填比价国别（ITAD/GG/CS 规则）', {
      whenToCall: '首次接入三列或批量对齐时。',
      purpose: 'ITAD=Steam cc；GG=社区码或欧元区 `eu` 等；CheapShark 固定 `US`。body `force:true` 时覆盖已有值。',
    }),
    ad('PATCH', '/api/admin/region-countries/:countryCode/enabled', '启用/禁用某国家', {
      whenToCall: '在列表中切换国家开关时。',
      purpose: '部分更新 Firestore 文档。',
    }),
    ad('GET', '/api/admin/video-sources', '视频源列表', {
      whenToCall: '进入视频源管理列表时。',
      purpose: '返回 YouTube/Steam 等采集源配置。',
    }),
    ad('POST', '/api/admin/video-sources/youtube', '创建 YouTube 视频源', {
      whenToCall: '添加一条 YouTube 渠道来源时。',
      purpose: '写入 video_sources 集合并可能触发校验。',
    }),
    ad('POST', '/api/admin/video-sources/steam', '创建 Steam 视频源', {
      whenToCall: '添加 Steam 预告片来源时。',
      purpose: '写入 video_sources。',
    }),
    ad('PATCH', '/api/admin/video-sources/:sourceId', '更新视频源', {
      whenToCall: '编辑源标题、启用状态等时。',
      purpose: '局部更新源文档。',
    }),
    ad('POST', '/api/admin/video-sources/:sourceId/ingest', '触发源抓取/入库', {
      whenToCall: '手动触发某源拉取元数据或队列任务时。',
      purpose: '创建下游视频任务或刷新缓存（依实现）。',
    }),
    ad('GET', '/api/admin/video-sources/:sourceId', '视频源详情', {
      whenToCall: '打开某一源的详情抽屉时。',
      purpose: '返回单条 video_source。',
    }),
    ad('GET', '/api/admin/videos', '视频列表（后台）', {
      whenToCall: '浏览已入库视频资产时。',
      purpose: '分页返回视频管理与发布状态。',
    }),
    ad('GET', '/api/admin/videos/:videoId', '视频详情（后台）', {
      whenToCall: '编辑或排查单个视频时。',
      purpose: '返回完整后台字段含任务状态。',
    }),
    ad('POST', '/api/admin/videos/:videoId/publish', '发布视频', {
      whenToCall: '运营将视频设为公开可见时。',
      purpose: '切换公开标记并对 CDN/缓存生效。',
    }),
    ad('POST', '/api/admin/videos/:videoId/unpublish', '下架视频', {
      whenToCall: '撤销公开发布时。',
      purpose: '从公开列表隐藏。',
    }),
    ad('POST', '/api/admin/videos/:videoId/reprocess', '重新处理视频', {
      whenToCall: '转码失败或需更换片源时。',
      purpose: '重置/排队重新执行任务。',
    }),
    ad('GET', '/api/admin/video-jobs', '视频任务列表', {
      whenToCall: '查看流水线任务队列与状态时。',
      purpose: '返回 pending/running/failed 等任务记录。',
    }),
    ad('POST', '/api/admin/video-jobs/:jobId/retry', '重试失败任务', {
      whenToCall: '对失败 Job 点「重试」时。',
      purpose: '将任务重新置为可调度状态。',
    }),
    ad('GET', '/api/admin/steam-games', 'Steam 游戏目录（后台浏览）', {
      whenToCall: '从后台检索已同步的 Steam 目录数据时。',
      purpose: '运营查看/搜索 catalog。',
    }),
    ad('POST', '/api/admin/steam-users/:steamId/sync', '单用户 Steam 同步', {
      whenToCall: '对单一 SteamId 触发同步任务时。',
      purpose: '手工修复某用户关联数据。',
    }),
    ad('GET', '/api/admin/games', '游戏管理列表', {
      whenToCall: '打开「游戏管理」列表时。',
      purpose: '分页查询游戏聚合行。',
    }),
    ad('POST', '/api/admin/games/sync-app-list', '同步 Steam AppList', {
      whenToCall: '运营手动「拉取 Steam 全量 App 列表」时。',
      purpose: '触发与 Worker 类似的 applist 入库逻辑（即时执行）。',
      notes: 'HTTP 触发；与 steam-sync.worker 定时任务互为补充。',
    }),
    ad('POST', '/api/admin/games/sync-details', '批量同步详情', {
      whenToCall: '选择一批 AppId 补全商店详情时。',
      purpose: '批量抓取详情写入 catalog。',
    }),
    ad('GET', '/api/admin/games/sync-jobs', 'Steam 同步任务历史', {
      whenToCall: '查看同步作业日志与结果统计时。',
      purpose: '返回 sync job 记录列表。',
    }),
    ad('GET', '/api/admin/games/:appid', '游戏详情（后台）', {
      whenToCall: '点进某一 App 的运营详情页时。',
      purpose: '返回完整后台游戏文档。',
    }),
    ad('POST', '/api/admin/games/:appid/sync-detail', '单游戏详情同步', {
      whenToCall: '对单个 appid 强制刷新商店详情时。',
      purpose: '即时抓取并覆盖 meta。',
    }),
    ad('POST', '/api/admin/games/:appid/sync-deals', '单游戏折扣同步', {
      whenToCall: '刷新该游戏折扣缓存时。',
      purpose:
        '按 Country/Steam 页**已启用**国家（或 body `countries`）分别拉 Steam/GG/ITAD/CheapShark；写入 `game_discount_offers`（一国一文档；API 仍扁平为 deal 列表）。',
    }),
    ad('POST', '/api/admin/games/sync-deals-batch', '批量折扣同步', {
      whenToCall: '按一批 AppId 同步折扣时。',
      purpose: '同上多国策略；可减少运营重复点击。',
    }),
    ad('POST', '/api/admin/games/sync-deals-hot-top', '热点/榜单折扣同步', {
      whenToCall: '按热门 Top 列表刷新促销数据时。',
      purpose: '对在线 Top 游戏批量执行多国折扣同步。',
    }),
    ad('POST', '/api/admin/games/:appid/sync-meta', '同步元数据（后台）', {
      whenToCall: '补标题、封面等多语言元数据时。',
      purpose: '写回 game meta 字段。',
    }),
    ad('POST', '/api/admin/games/:appid/load-reviews', '拉取 Steam 评测摘要', {
      whenToCall: '需要把评测评分拉入后台展示时。',
      purpose: '调用商店评测接口并持久化。',
    }),
    ad('GET', '/api/admin/games/:appid/deal-links', '列出联盟链接配置', {
      whenToCall: '维护购买跳转链接时。',
      purpose: '返回 deal link 行。',
    }),
    ad('POST', '/api/admin/games/:appid/deal-links', '新增 deal link', {
      whenToCall: '添加一条渠道跳转规则时。',
      purpose: '写入 `game_discount_offers`（扁平为 deal 列表）。',
    }),
    ad('PATCH', '/api/admin/games/:appid/deal-links/:dealId', '更新 deal link', {
      whenToCall: '编辑已有跳转链接时。',
      purpose: 'PATCH 单条 deal link。',
    }),
    ad('GET', '/api/admin/sqlite/info', 'SQLite 连接信息', {
      whenToCall: '打开「SQLite 数据库」页时。',
      purpose: '返回 data-api 地址（脱敏）、表数量与 game_catalog 行数。',
    }),
    ad('GET', '/api/admin/sqlite/tables', 'SQLite 表列表', {
      whenToCall: '浏览库表结构时。',
      purpose: '各表主键、可筛选列与是否含 data_json。',
    }),
    ad('GET', '/api/admin/sqlite/tables/:table/rows', 'SQLite 表行查询', {
      whenToCall: '按主键/ID 筛选或分页浏览时。',
      purpose: '参数化 SELECT，仅允许 ID 类列等值过滤。',
    }),
    ad('PATCH', '/api/admin/sqlite/tables/:table/rows', 'SQLite 行更新', {
      whenToCall: '在后台编辑单行字段时。',
      purpose: '按主键 UPDATE 指定列（含 data_json 校验）。',
    }),
    ad('GET', '/api/admin/users', 'App 用户列表', {
      whenToCall: '后台检索注册用户时。',
      purpose: '分页查看用户基础信息与 flags。',
    }),
    ad('PATCH', '/api/admin/users/:userId', '更新用户（后台）', {
      whenToCall: '封禁、备注或修正用户字段时。',
      purpose: 'PATCH 用户文档。',
    }),
  ];
}
