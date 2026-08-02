/**
 * 各「折扣数据平台」请求里用到的国家/地区参数说明与已知取值。
 * 用于 Admin `itadCountry` / `ggDealsRegion` / `cheapsharkCountry` 与客户端询价对齐。
 *
 * API 契约与端点文档见：`external-deal-api.catalog.ts`
 *
 * ## IsThereAnyDeal（ITAD）
 * - 文档：https://docs.isthereanydeal.com/
 * - Prices: POST `/games/prices/v3` + query `country`（ISO 3166-1 alpha-2）
 * - Deals List: GET `/deals/v2` + query `country`
 * - 无公开国家枚举；未覆盖国家可能空数据，需用 key 抽测
 *
 * ## GG.deals（`region` query，小写）
 * - 文档：https://gg.deals/api/prices/
 * - 官方 region 列表见 `GG_DEALS_OFFICIAL_REGION_CODES`（`external-deal-api.catalog.ts`）
 * - 非官方 region（如 jp/kr）经 `resolveGgDealsApiRegion` **显式代理**到最近官方区再请求；
 *   写入 `ggDetail.regionProxied`，避免当成静默伪成本区价。
 */
import {
  GG_DEALS_OFFICIAL_REGION_CODES,
  isGgDealsOfficialRegion,
} from './external-deal-api.catalog';

export { GG_DEALS_OFFICIAL_REGION_CODES, isGgDealsOfficialRegion };

/** @deprecated 使用 GG_DEALS_OFFICIAL_REGION_CODES；保留别名供旧引用 */
export const GG_DEALS_COMMUNITY_REGION_CODES = GG_DEALS_OFFICIAL_REGION_CODES;

const GG_SET = new Set<string>(GG_DEALS_OFFICIAL_REGION_CODES);

export type GgDealsCommunityRegionCode = (typeof GG_DEALS_OFFICIAL_REGION_CODES)[number];

/** GG 官方文档列出的 region */
export function isGgDealsCommunityDocumentedRegion(region: string): boolean {
  return isGgDealsOfficialRegion(region);
}

/**
 * Steam 店区为欧元定价、但 GG 官方 region 无单独码时，使用泛欧 **`eu`**。
 * 非欧元区切勿映射到 `eu`（如 CZ/HU/RO 仍用各自小写 ISO2，但 API 可能不支持）。
 */
export const GG_DEALS_EU_BUCKET_STEAM_COUNTRIES = new Set<string>([
  'AT',
  'PT',
  'GR',
  'MT',
  'CY',
  'SK',
  'SI',
  'EE',
  'LV',
  'LT',
  'LU',
  'HR',
]);

/**
 * 官方 Prices API 未覆盖的 region → 最近官方区（显式代理）。
 * JP/KR/CN 等亚太 → `us`（与常见聚合站一致；币种为代理区货币，非本区 Steam 价）。
 * 拉丁美洲未覆盖 → `br`。
 */
export const GG_DEALS_UNSUPPORTED_REGION_PROXY: Record<string, string> = {
  jp: 'us',
  kr: 'us',
  cn: 'us',
  tw: 'us',
  hk: 'us',
  mo: 'us',
  sg: 'us',
  my: 'us',
  th: 'us',
  vn: 'us',
  ph: 'us',
  id: 'us',
  in: 'us',
  nz: 'us',
  mx: 'br',
  ar: 'br',
  cl: 'br',
  co: 'br',
  pe: 'br',
  uy: 'br',
  za: 'us',
  sa: 'us',
  ae: 'us',
  ua: 'eu',
  il: 'eu',
  cz: 'eu',
  hu: 'eu',
  ro: 'eu',
};

export type GgDealsResolvedApiRegion = {
  /** 实际请求 GG API 的 region */
  apiRegion: string;
  /** 配置/推导的原 region */
  requestedRegion: string;
  /** 是否走了官方外代理 */
  proxied: boolean;
};

/**
 * 将配置中的 GG region 解析为可请求的官方 API region。
 * 官方列表内原样返回；否则按亚太/拉美/欧元邻近表代理，缺省 `us`。
 */
export function resolveGgDealsApiRegion(requested: string): GgDealsResolvedApiRegion {
  const requestedRegion = String(requested || 'us')
    .trim()
    .toLowerCase()
    .slice(0, 2);
  const safeReq = /^[a-z]{2}$/.test(requestedRegion) ? requestedRegion : 'us';
  if (isGgDealsOfficialRegion(safeReq)) {
    return { apiRegion: safeReq, requestedRegion: safeReq, proxied: false };
  }
  if (GG_DEALS_EU_BUCKET_STEAM_COUNTRIES.has(safeReq.toUpperCase())) {
    return { apiRegion: 'eu', requestedRegion: safeReq, proxied: true };
  }
  const proxy = GG_DEALS_UNSUPPORTED_REGION_PROXY[safeReq] ?? 'us';
  const apiRegion = isGgDealsOfficialRegion(proxy) ? proxy : 'us';
  return { apiRegion, requestedRegion: safeReq, proxied: true };
}

/**
 * 由 Steam 商店 `cc`（ISO2 大写）推导 GG.deals `region`（小写）。
 * - 在官方 region 列表中 → 直接用该码（含 `gb` 非 `uk`）。
 * - 在欧元 bucket 表中 → `eu`。
 * - 其余 → 小写 ISO2（同步时经 `resolveGgDealsApiRegion` 代理到官方区）。
 */
export function ggDealsRegionFromSteamCc(steamCcUpper: string): string {
  const cc = String(steamCcUpper ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const safe = /^[A-Z]{2}$/.test(cc) ? cc : 'US';
  const low = safe.toLowerCase();
  if (GG_SET.has(low)) return low;
  if (GG_DEALS_EU_BUCKET_STEAM_COUNTRIES.has(safe)) return 'eu';
  return low;
}

/** Admin 自动完成：官方 region + 常见 Steam 国别（非官方者同步时会代理） */
export function ggDealsRegionSuggestOptions(): string[] {
  const fromDefaults = [
    'jp',
    'kr',
    'cn',
    'tw',
    'hk',
    'sg',
    'nz',
    'in',
    'mx',
    'ar',
    'cl',
    'co',
    'za',
    'sa',
    'ae',
    'id',
    'th',
    'vn',
    'ph',
    'my',
    'ua',
    'il',
    'cz',
    'hu',
    'ro',
    'ng',
    'pk',
    'bd',
    'ke',
    'lk',
    'np',
    'gh',
    'tz',
    'ug',
    'jm',
    'tt',
    'zw',
    'mu',
    'bz',
    'gy',
    'et',
    'bw',
  ];
  const merged = new Set<string>([...GG_DEALS_COMMUNITY_REGION_CODES, ...fromDefaults]);
  return Array.from(merged).sort();
}

/**
 * CheapShark：`GET /deals` 的 `country` 在实测下不改变结果；接口偏美元/全球聚合。
 * 统一使用 **US**，避免误以为各国不同值会得到不同折扣数据。
 */
export const CHEAPSHARK_LIST_COUNTRY = 'US' as const;

/**
 * ## CheapShark（`GET /deals` 可选 `country`）
 * - 请求可带两位 `country`，但 **未发现** 官方维护的「支持国家」列表。
 * - 本仓库用 axios 对比 `country=US` 与 `country=DE` 的首页 dealID **完全一致**，说明该参数对列表 **很可能无区域价语义**；不宜依赖它做「按国别折后价」。
 * - 文档入口：https://www.cheapshark.com/api/1.0/ （请求需带描述性 User-Agent）
 */
