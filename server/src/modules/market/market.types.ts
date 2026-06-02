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
