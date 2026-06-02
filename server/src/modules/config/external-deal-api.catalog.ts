/**
 * 外部折扣/比价平台 API 契约（与实现共用）。
 * 文档入口：
 * - ITAD: https://docs.isthereanydeal.com/
 * - GG.deals Prices: https://gg.deals/api/prices/
 */

export const ITAD_API = {
  docUrl: 'https://docs.isthereanydeal.com/',
  openapiUrl: 'https://github.com/IsThereAnyDeal/API/blob/master/dist/openapi.json',
  baseUrlDefault: 'https://api.isthereanydeal.com',
  /** Steam 商店 shop id（Prices / Deals 文档示例一致） */
  steamShopId: 61,
  endpoints: {
    gamesLookupV1: {
      method: 'GET' as const,
      path: '/games/lookup/v1',
      docTag: 'Games Lookup',
      query: ['key|token', 'appid'],
      purpose: 'Steam appid → ITAD game UUID / slug',
    },
    gamesPricesV3: {
      method: 'POST' as const,
      path: '/games/prices/v3',
      docTag: 'Prices',
      docUrl: 'https://docs.isthereanydeal.com/#tag/Prices',
      query: ['key|token', 'country', 'deals?', 'vouchers?', 'capacity?', 'shops?'],
      body: 'JSON array of ITAD game UUIDs (1..200)',
      purpose: '按国拉取各店现价；deals[].url 为 itad.link 购买跳转',
    },
    gamesOverviewV2: {
      method: 'POST' as const,
      path: '/games/overview/v2',
      docTag: 'Prices',
      query: ['key|token', 'country', 'shops?', 'vouchers?'],
      body: 'JSON array of ITAD game UUIDs (1..200)',
      purpose: '每游戏当前最低价 + 史低 + 活跃 bundle 概览',
    },
    dealsV2Get: {
      method: 'GET' as const,
      path: '/deals/v2',
      docTag: 'Deals List',
      docUrl: 'https://docs.isthereanydeal.com/#tag/Deals-List',
      query: ['key|token', 'country', 'offset', 'limit', 'sort?', 'shops?', 'nondeals?', 'mature?'],
      purpose: '分页优惠清单；list[].deal.url 为折扣购买链接',
    },
    gamesInfoV2: {
      method: 'GET' as const,
      path: '/games/info/v2',
      docTag: 'Games Info',
      query: ['key|token', 'id'],
      purpose: '游戏元数据、Steam appid、urls.game',
    },
    gamesHistoryV2: {
      method: 'GET' as const,
      path: '/games/history/v2',
      docTag: 'Games History',
      query: ['key|token', 'id', 'country', 'shops'],
      purpose: '价格历史曲线（分国、分店）',
    },
    gamesBundlesV2: {
      method: 'GET' as const,
      path: '/games/bundles/v2',
      docTag: 'Games Bundles',
      query: ['key|token', 'id', 'country', 'expired?'],
      purpose: '当前/历史 bundle 列表',
    },
  },
} as const;

/** GG.deals 官方 Prices API 支持的 region（2026-04 文档） */
export const GG_DEALS_OFFICIAL_REGION_CODES = [
  'au',
  'be',
  'br',
  'ca',
  'ch',
  'de',
  'dk',
  'es',
  'eu',
  'fi',
  'fr',
  'gb',
  'ie',
  'it',
  'nl',
  'no',
  'pl',
  'se',
  'us',
] as const;

export type GgDealsOfficialRegionCode = (typeof GG_DEALS_OFFICIAL_REGION_CODES)[number];

const GG_OFFICIAL_SET = new Set<string>(GG_DEALS_OFFICIAL_REGION_CODES);

export function isGgDealsOfficialRegion(region: string): boolean {
  return GG_OFFICIAL_SET.has(String(region ?? '').trim().toLowerCase());
}

export const GG_DEALS_API = {
  docUrl: 'https://gg.deals/api/prices/',
  baseUrlDefault: 'https://api.gg.deals',
  officialRegions: GG_DEALS_OFFICIAL_REGION_CODES,
  rateLimit: {
    recordsPerMinute: 100,
    recordsPerHour: 1000,
    maxIdsPerRequest: 100,
    headers: ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset'] as const,
  },
  endpoints: {
    pricesBySteamAppId: {
      method: 'GET' as const,
      path: '/v1/prices/by-steam-app-id/',
      query: ['key', 'ids', 'region?'],
      responseShape: '{ success, data: { [steamAppId]: GamePrices|null } }',
      gamePricesFields: ['title', 'url', 'prices.currentRetail', 'prices.currentKeyshops', 'prices.currency'],
      purpose: '按 Steam App ID + region 取当前 retail/keyshop 最低价',
    },
    pricesBySteamSubId: {
      method: 'GET' as const,
      path: '/v1/prices/by-steam-sub-id/',
      query: ['key', 'ids', 'region?'],
    },
    pricesBySteamBundleId: {
      method: 'GET' as const,
      path: '/v1/prices/by-steam-bundle-id/',
      query: ['key', 'ids', 'region?'],
    },
  },
} as const;

/** Admin / 诊断：结构化 API 文档摘要 */
export function listExternalDealApiDocs() {
  return {
    isthereanydeal: {
      docUrl: ITAD_API.docUrl,
      openapiUrl: ITAD_API.openapiUrl,
      baseUrlDefault: ITAD_API.baseUrlDefault,
      steamShopId: ITAD_API.steamShopId,
      endpoints: Object.entries(ITAD_API.endpoints).map(([id, e]) => ({ id, ...e })),
    },
    ggdeals: {
      docUrl: GG_DEALS_API.docUrl,
      baseUrlDefault: GG_DEALS_API.baseUrlDefault,
      officialRegions: [...GG_DEALS_API.officialRegions],
      rateLimit: GG_DEALS_API.rateLimit,
      endpoints: Object.entries(GG_DEALS_API.endpoints).map(([id, e]) => ({ id, ...e })),
    },
  };
}
