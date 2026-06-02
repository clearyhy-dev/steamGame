export type DashboardStats = {
  totalVideos: number;
  readyVideos: number;
  failedVideos: number;
  publicVideos: number;
  pendingJobs: number;
  runningJobs: number;
};

export type DiscountProvidersSettings = {
  itadApiKey: string;
  ggDealsApiKey: string;
  steamApiKey: string;
  itadBaseUrl: string;
  ggDealsBaseUrl: string;
  cheapSharkBaseUrl: string;
  steamWebApiBaseUrl: string;
  steamStoreBaseUrl: string;
  updatedAt: string;
  createdAt: string;
};

export type RuntimeEffectiveSettings = {
  adminUsername: string;
  adminPassword: string;
  adminPasswordSet?: boolean;
  steamApiKey: string;
  steamOpenidRealm: string;
  steamOpenidReturnUrl: string;
  appDeeplinkScheme: string;
  appDeeplinkSuccessHost: string;
  appDeeplinkFailHost: string;
  appBaseUrl: string;
  steamHttpTimeoutMs: number;
  steamAutoSyncEnabled: boolean;
  steamAutoSyncIntervalMs: number;
  steamAutoSyncBatchSize: number;
  steamAutoSyncDelayMs: number;
  requestLogRetentionDays: number;
  videoGcsBucket: string;
  ffmpegPath: string;
  ffprobePath: string;
  ytDlpPath: string;
  videoTempDir: string;
  videoMaxDurationSec: number;
  videoTrimSec: number;
  videoSignedUrlMinutes: number;
  videoWorkerIntervalMs: number;
  appConnectTimeoutSec: number;
  appReceiveTimeoutSec: number;
};

export type AdminRequestLogRow = {
  logId?: string;
  requestId: string;
  method: string;
  path: string;
  statusCode: number;
  durationMs: number;
  userId?: string;
  ip?: string;
  userAgent?: string;
  referer?: string;
  query?: Record<string, string>;
  bodyKeys?: string[];
  errorCode?: string;
  createdAt?: string | null;
};

export type RuntimeSettingsResponse = {
  effective: RuntimeEffectiveSettings;
  /** 合并 APP_BASE_URL 与可选覆盖后的最终文档地址（与 GET /api/config 一致） */
  resolved: { appSwaggerUiUrl: string; appOpenApiJsonUrl: string };
  stored: Record<string, unknown>;
};

export type DataPlacementRow = {
  category: string;
  examples: string;
  primaryStore: string;
  notes: string;
};

export type InfrastructureConfigResponse = {
  policy: {
    largeObjectsOnGcpForbidden: boolean;
    discountOffersPersistence: string;
    cacheUploadBackend: string;
  };
  warnings: string[];
  dataPlacement: DataPlacementRow[];
  minio: {
    enabled: boolean;
    endpoint?: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    publicCdnBase?: string;
    consoleUrlHint?: string;
  };
  redis: {
    enabled: boolean;
    url?: string;
    host?: string;
    port?: number;
    hasPassword?: boolean;
  };
  sqlite: {
    pathOnVultrHost: string;
    appConnected: boolean;
    dataApiUrl?: string;
    note: string;
  };
  gcp: {
    firestoreProjectId: string;
    gcsConfigured: boolean;
    gcsCacheBucket: string;
    videoGcsBucket: string;
  };
};

export type InfrastructureMinioBrowseResponse = {
  bucket: string;
  prefix: string;
  objects: { key: string; size: number; lastModified: string | null }[];
  truncated: boolean;
  prefixSummary: { prefix: string; objectCount: number; totalBytes: number }[];
};

export type InfrastructureRedisBrowseResponse = {
  connected: boolean;
  dbSize: number;
  memoryHuman?: string;
  keyPrefix: string;
  sampleKeys: string[];
  error?: string;
};

export type MetaEndpointRow = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  authRequired: boolean;
  scope: 'app_backend' | 'app_public' | 'admin' | 'third_party';
  /** App / Admin / 公开 / OAuth / 运维 / 混合 */
  audience?: 'app' | 'admin' | 'public' | 'browser_oauth' | 'ops' | 'mixed';
  name: string;
  usedBy?: string[];
  notes?: string;
  whenToCall?: string;
  purpose?: string;
};

export type MetaEndpointsResponse = {
  apiBaseUrl: string;
  generatedAt: string;
  endpoints: MetaEndpointRow[];
};

export type SteamSyncJobRow = {
  jobId: string;
  trigger: 'worker' | 'manual_app_list' | 'manual_detail_batch';
  status: 'success' | 'partial' | 'failed';
  appListProcessed: number;
  appListInserted: number;
  appListUpdated: number;
  detailTotal: number;
  detailSuccess: number;
  detailFailed: number;
  message?: string;
  startedAt: string;
  finishedAt: string;
  elapsedMs: number;
  createdAt: string;
};

export type VideoSourceRow = {
  sourceId: string;
  gameId: string;
  steamAppId?: string;
  sourceType: string;
  title: string;
  sourceUrl?: string;
  ingestMode: string;
  enabled: boolean;
  priority: number;
  gameHeaderImage?: string | null;
  gameName?: string | null;
  gameDescription?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type VideoRow = {
  videoId: string;
  sourceId: string;
  gameId: string;
  steamAppId?: string;
  sourceType: string;
  title: string;
  status: string;
  visibility: string;
  durationSec?: number;
  deliveryType: string;
  thumbnailUrl?: string;
  /** 无预告片封面时由 API 回填的游戏头图 */
  gameHeaderImage?: string | null;
  playbackUrl?: string;
  signedPlaybackUrl?: string;
  signedPlaybackExpiresAt?: string | null;
  storagePath?: string;
  variants?: Array<{ name: string; storagePath?: string; signedUrl?: string }>;
  tags?: string[];
  errorMessage?: string;
  gameName?: string | null;
  publishedBy?: string | null;
  publishedAt?: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type VideoJobRow = {
  jobId: string;
  videoId: string;
  jobType: string;
  status: string;
  attempt: number;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage?: string;
  createdAt: string | null;
};

export type SteamGameRow = {
  ownerSteamId: string;
  source: 'owned' | 'recent';
  appid: string;
  name: string;
  headerImage?: string;
  playtimeForever?: number;
  lastFetchedAt: string | null;
};

/** 管理端列表 `insight_country` 列：与 `buildCountryInsightForAdminList` 对齐 */
export type GameCountryInsight = {
  countryCode: string;
  steamStoreUrl?: string | null;
  steamPurchaseUrl?: string | null;
  configuredCurrency?: string | null;
  steamPriceCurrency?: string | null;
  itadPurchaseUrl?: string | null;
  itadProviderLabel?: string;
  itadBucketCountry?: string;
  itadApiCountry?: string | null;
  itadCurrentFinal?: number | null;
  itadCurrentOriginal?: number | null;
  itadCurrentCurrency?: string | null;
  itadCurrentDiscountPercent?: number | null;
  itadCurrentPriceDisplay?: string | null;
  ggDealsUrl?: string | null;
  ggProviderLabel?: string;
  ggBucketCountry?: string;
  ggApiRegion?: string | null;
  ggCurrentFinal?: number | null;
  ggCurrentCurrency?: string | null;
  ggCurrentDiscountPercent?: number | null;
  ggCurrentPriceDisplay?: string | null;
  ggOfficialPrices?: {
    currentRetail?: number;
    currentKeyshops?: number;
    historicalRetail?: number;
    historicalKeyshops?: number;
    currency?: string;
    lowestCurrentSource?: 'retail' | 'keyshop';
  } | null;
  ggNearHistoricalLow?: boolean | null;
  ggTrendScore?: number | null;
  ggHotToday?: boolean | null;
  ggTrending?: boolean | null;
  ggRising?: boolean | null;
  ggRecentAttention?: boolean | null;
  ggPlayerRatingPercent?: number | null;
  ggPlayerRatingLabel?: string | null;
  cheapSharkUrl?: string | null;
  itadGameId?: string | null;
  historyLowAll?: string | null;
  historyLowY1?: string | null;
  historyLowM3?: string | null;
  itadBundleCount?: number;
  itadPriceHistoryPoints?: number;
  itadWaitlisted?: unknown;
  itadRank?: unknown;
  nearHistoricalLow?: boolean | null;
  worthBuy?: {
    score: number;
    D: number;
    R: number;
    P: number;
    T: number;
    formula?: string;
    computedAt?: string | null;
  } | null;
  multiStoreExpansionNote?: string;
  ggDiscoveryNote?: string;
};

export type GameManageRow = {
  appid: string;
  name: string;
  headerImage?: string;
  linkedVideos: number;
  originalPrice?: number;
  currentPlayers?: number;
  discountPercent: number;
  steamDiscountPercent?: number | null;
  itadDiscountPercent?: number | null;
  ggDealsDiscountPercent?: number | null;
  cheapSharkDiscountPercent?: number | null;
  hasDealLink: boolean;
  hasDiscountInfo?: boolean;
  hasSourceDiscountInfo?: boolean;
  maxHotnessScore?: number;
  detailSynced?: boolean;
  clickCount: number;
  lastDetailSyncAt: string | null;
  /** 最近一次各渠道价格同步时间（来自分桶 offer） */
  lastPriceSyncAt?: string | null;
  /** 在 DEAL_SYNC_PRICE_DAY_TZ（默认 Asia/Shanghai）日历日内已同步过价格 */
  priceSyncedToday?: boolean;
  countryInsight?: GameCountryInsight;
};

export type DealLinkRow = {
  dealId: string;
  appid: string;
  source:
    | 'steam'
    | 'isthereanydeal'
    | 'ggdeals'
    | 'cheapshark'
    | 'affiliate'
    | 'fanatical'
    | 'cdkeys'
    | 'gearup'
    | 'manual';
  url: string;
  isAffiliate: boolean;
  isActive: boolean;
  priority: number;
  countryCode?: string;
  currency?: string;
  originalPrice?: number;
  finalPrice?: number;
  discountPercent?: number;
  hotnessScore?: number | null;
  offerStatus?: 'active' | 'stale' | 'invalid';
  invalidReason?: string;
  lastCheckedAt?: string | null;
  lastPriceSyncAt?: string | null;
  startAt: string | null;
  endAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type GameDetailResponse = {
  game: {
    appid: string;
    name: string;
    headerImage?: string;
    screenshots: string[];
    trailerUrls: string[];
    steamStoreUrl?: string;
    shortDescription?: string;
    developers?: string[];
    publishers?: string[];
    categories: string[];
    genres: string[];
    tags?: string[];
    discountPercent?: number;
    currentPlayers?: number;
    clickCount?: number;
    lastDetailSyncAt?: string | null;
    /** 多国分桶比价快照（`game_discount_offers`） */
    byCountry?: Record<string, Record<string, unknown>>;
    /** 周热度主表 `game_weekly_heat` */
    weeklyHeat?: {
      currentPlayers?: number | null;
      weekKey?: string | null;
      fetchedAt?: string | null;
      playersDaily?: Array<{ day: string; players: number }>;
    };
  };
  dealLinks?: DealLinkRow[];
  bestDeal?: {
    appid: string;
    url: string;
    source: string;
    dealId?: string;
  };
  reviewSummary: {
    reviewScoreDesc: string;
    positivePercent: number;
    totalReviews: number;
    totalPositive: number;
    totalNegative: number;
  } | null;
  reviews: Array<{
    reviewId: string;
    authorSteamId: string;
    content: string;
    language: string;
    votedUp: boolean;
    votesUp: number;
    timestampCreated: number;
    timestampUpdated: number;
  }>;
  videos: VideoRow[];
};

export type ScheduledTaskKey =
  | 'steam_catalog_sync'
  | 'market_country_round_robin'
  | 'market_build_lists'
  | 'cleanup_invalid_deal_links'
  | 'build_public_cache'
  | 'request_log_cleanup';

export type ScheduledTaskConfigRow = {
  id: string;
  label: string;
  enabled: boolean;
  taskKey: ScheduledTaskKey;
  /** IANA；默认美国东部 */
  timezone: string;
  frequency: 'daily' | 'hourly' | 'every_n_hours';
  timeOfDay?: string;
  everyHours?: number;
  payload?: Record<string, unknown>;
  lastRunAt?: string | null;
  lastRunOk?: boolean | null;
  lastRunSummary?: string | null;
  lastError?: string;
};

export type ScheduledTasksConfigResponse = {
  tasks: ScheduledTaskConfigRow[];
  updatedAt: string;
  createdAt: string;
  discountOffersPersistence?: 'firestore' | 'object_storage';
};

export type MarketPlatformPriceCell = {
  originalPrice: number | null;
  finalPrice: number | null;
  discountPercent: number | null;
  currency: string | null;
  url: string | null;
};

export type MarketGamePriceSummary = {
  originalPrice: number | null;
  finalPrice: number | null;
  discountPercent: number | null;
  steamStoreUrl: string | null;
  platforms: {
    steam: MarketPlatformPriceCell;
    isthereanydeal: MarketPlatformPriceCell;
    ggdeals: MarketPlatformPriceCell;
    cheapshark: MarketPlatformPriceCell;
  };
};

export type MarketGameRow = {
  countryCode: string;
  appid: string;
  name: string;
  currency: string;
  currencySymbol: string;
  currentPlayers: number;
  discountPercent: number;
  originalPrice: number | null;
  finalPrice: number | null;
  heatScore: number;
  detailSyncedAtMs: number | null;
  priceSyncedAtMs: number | null;
  detailJsonPath: string;
  heatJsonPath: string;
  pricesJsonPath: string;
  priceSummary: MarketGamePriceSummary | null;
};

export type MarketSyncGlobalState = {
  countryQueue: string[];
  currentCountryIndex: number;
  currentCountryCode: string | null;
  appidCursor: string;
  lastRunAtMs: number | null;
  lastRunSummary: string | null;
};

export type MarketGamesListResponse = {
  countryCode: string;
  currency: string;
  currencySymbol: string;
  page: number;
  pageSize: number;
  total: number;
  rows: MarketGameRow[];
};

export type MarketGameDetailResponse = {
  index: MarketGameRow | null;
  detail: Record<string, unknown> | null;
  heat: Record<string, unknown> | null;
  prices: Record<string, unknown> | null;
  priceSummary: MarketGamePriceSummary | null;
};

export type SqliteDbInfo = {
  dataStore: string;
  sqliteApiUrl: string;
  tableCount: number;
  gameCatalogCount: number | null;
};

export type SqliteColumnMeta = {
  name: string;
  type: string;
  notnull: boolean;
  dfltValue: string | null;
  pk: number;
};

export type SqliteTableMeta = {
  name: string;
  columnCount: number;
  primaryKeyColumns: string[];
  hasDataJson: boolean;
  filterableColumns: string[];
};

export type SqliteRowsResponse = {
  table: string;
  rows: Record<string, unknown>[];
  limit: number;
  offset: number;
  total?: number;
};

export type AdminUserRow = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  authProviders: string[];
  steamId: string | null;
  steamPersonaName: string | null;
  steamAvatar: string | null;
  steamProfileUrl: string | null;
  adminNote: string;
  disabled: boolean;
  registeredAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};
