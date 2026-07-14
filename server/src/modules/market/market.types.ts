import type { SteamStoreGameDetail } from '../steam/steam-store.service';
import type { GameCountryPriceBucket } from '../game/game-catalog.repository';
import type { MarketGamePriceSummary } from './market-price-summary.util';

export type MarketDetailDoc = SteamStoreGameDetail & {
  countryCode: string;
  steamCc: string;
  steamLanguage: string;
  syncedAt: string;
};

export type MarketHeatDoc = {
  countryCode: string;
  appid: string;
  currentPlayers: number;
  heatScore: number;
  catalogDiscountPercent?: number;
  syncedAt: string;
};

export type MarketPricesDoc = {
  countryCode: string;
  appid: string;
  currency: string;
  currencySymbol: string;
  bucket: GameCountryPriceBucket | null;
  syncedAt: string;
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

export type MarketRoundRobinPayload = {
  batchSize?: number;
  topNPerCountry?: number;
  delayMs?: number;
  /** 默认 true：当日已同步的 (country, appid) 跳过 */
  skipSyncedToday?: boolean;
  forceRefresh?: boolean;
  /** 默认 false：不拉 Steam 详情 JSON */
  includeDetail?: boolean;
  /** 默认 false：不拉在线人数 */
  includeHeat?: boolean;
  /** 默认 true：拉四平台价 */
  includePrices?: boolean;
  /** 默认 10：批内并发 appid 数 */
  concurrency?: number;
  platforms?: string[];
  /** 将轮询游标重置到队列首国、appid 起点 0（仅本批生效） */
  resetQueue?: boolean;
  /** 单次 cron 连续跑几批（默认 1；计划任务建议 4 以覆盖 Top200/国） */
  batchesPerRun?: number;
  /** 每日全量同步前清理旧折扣（默认 true） */
  cleanupBeforeSync?: boolean;
  cleanupMaxRows?: number;
  cleanupMaxBatches?: number;
  cleanupStaleOlderThanHours?: number;
  /** 仅同步 T1 或 T2 国家（分任务调度）；未设则按当日 tier 规则合并 */
  syncTierFilter?: 'T1' | 'T2';
};

/** 分片轮询：workerId 负责 queue[index % workerCount === workerId] 的国家 */
export type MarketRoundRobinShardPayload = MarketRoundRobinPayload & {
  workerId: number;
  workerCount?: number;
  /** 重置本分片 worker 游标及分片内各国 appid 游标 */
  resetShard?: boolean;
  /** 为 true 时使用 payload.topNPerCountry，忽略 T1/T2 分层 TopN */
  ignoreSyncTier?: boolean;
};

export type MarketShardSyncStatus = {
  workerCount: number;
  fullQueue: string[];
  workers: Array<{
    workerId: number;
    workerCount: number;
    currentShardIndex: number;
    shardQueue: string[];
    shardSize: number;
    lastRunAtMs: number | null;
    lastRunSummary: string | null;
  }>;
};

export type MarketStaleDiscountCleanupResult = {
  scanned: number;
  clearedIndex: number;
  clearedObjects: number;
  skipped: number;
};

export type MarketDailyFullSyncResult = {
  countries: number;
  countriesCompleted: number;
  batches: number;
  totalProcessed: number;
  totalSuccess: number;
  totalFailed: number;
  totalSkipped: number;
  cleanup?: MarketStaleDiscountCleanupResult;
  summary: string;
};

export type MarketSyncGameResult = {
  appid: string;
  ok: boolean;
  detailOk: boolean;
  heatOk: boolean;
  pricesOk: boolean;
  skipped?: boolean;
  message?: string;
};

export type MarketRoundRobinResult = {
  countryCode: string;
  currency: string;
  currencySymbol: string;
  batchSize: number;
  topNPerCountry: number;
  processed: number;
  success: number;
  failed: number;
  skipped: number;
  nextAppidCursor: string;
  countryCompleted: boolean;
  nextCountryCode: string | null;
  summary: string;
};

export type MarketRoundRobinShardResult = MarketRoundRobinResult & {
  workerId: number;
  workerCount: number;
  shardIndex: number;
  shardCountries: string[];
};

export type MarketDailyShardedFullSyncResult = MarketDailyFullSyncResult & {
  workerCount: number;
  workers: Array<{
    workerId: number;
    countriesCompleted: number;
    batches: number;
    totalProcessed: number;
    totalSuccess: number;
    totalFailed: number;
    totalSkipped: number;
  }>;
};
