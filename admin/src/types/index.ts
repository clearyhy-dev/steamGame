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
  itadBaseUrl: string;
  ggDealsBaseUrl: string;
  cheapSharkBaseUrl: string;
  dealCountriesCsv: string;
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
  appSupportedDealCountriesCsv?: string;
  appCountryMapJson?: string;
  appCountryCurrencyMapJson?: string;
};

export type RuntimeSettingsResponse = {
  effective: RuntimeEffectiveSettings;
  stored: Record<string, unknown>;
};

export type RegionSettings = {
  enabledCountries: string[];
  defaultCountry: string;
  fallbackCountry: string;
  countryCurrencyMap: Record<string, string>;
  countryLanguageMap: Record<string, string>;
  priceSources: string[];
  cacheHours: number;
  showKeyshopDeals: boolean;
  showRegionWarning: boolean;
  updatedAt?: string;
  createdAt?: string;
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
    discountUrl: string;
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
