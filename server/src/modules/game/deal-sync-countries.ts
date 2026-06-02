import type { RegionCountryRepository } from '../config/region-country.repository';

/** `enabled`：仅前台已启用国；`all_configured`：`region_country_configs` 中全部配置（不按启用过滤）。 */
export type DealSyncCountryScope = 'enabled' | 'all_configured';

/**
 * 折扣同步国家列表。`enabled` 以 Country/Steam 页 **已启用** 为准；`all_configured` 为库内全部国家行。
 * 无可用国家时回退 `US`。
 */
export async function resolveDealSyncCountryCodes(
  repo: RegionCountryRepository,
  scope: DealSyncCountryScope = 'enabled',
): Promise<string[]> {
  const rows = scope === 'all_configured' ? await repo.listAllForAdmin() : await repo.listEnabledPublic();
  const codes = Array.from(
    new Set(
      rows
        .map((r) => String(r.countryCode ?? '').trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c)),
    ),
  ).sort((a, b) => a.localeCompare(b));
  if (codes.length > 0) return codes;
  if (scope === 'enabled') return [];
  return ['US'];
}

/** 计划任务默认覆盖：东南亚 + 欧美 + 拉美主市场（可在任务 payload.countries 覆盖） */
export const SCHEDULED_DEAL_PRIMARY_COUNTRIES = [
  'US',
  'GB',
  'DE',
  'FR',
  'IT',
  'ES',
  'NL',
  'PL',
  'AU',
  'NZ',
  'JP',
  'KR',
  'SG',
  'MY',
  'TH',
  'ID',
  'PH',
  'VN',
  'IN',
  'BR',
  'MX',
  'CA',
  'HK',
  'TW',
] as const;

const MARKET_PRIORITY: string[] = [...SCHEDULED_DEAL_PRIMARY_COUNTRIES, 'TR', 'AE', 'ZA', 'CH', 'SE', 'NO', 'DK', 'AT', 'BE', 'PT', 'CZ', 'HU', 'RO', 'UA'];

export function prioritizeMarketCountries(codes: string[], cap: number): string[] {
  if (cap <= 0 || codes.length <= cap) return codes;
  const set = new Set(codes);
  const out: string[] = [];
  for (const c of MARKET_PRIORITY) {
    if (!set.has(c)) continue;
    out.push(c);
    set.delete(c);
    if (out.length >= cap) return out;
  }
  for (const c of [...set].sort((a, b) => a.localeCompare(b))) {
    out.push(c);
    if (out.length >= cap) break;
  }
  return out;
}

function parseCountryList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return Array.from(
    new Set(
      raw
        .map((x) => String(x ?? '').trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c)),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

/** 与 Admin「Country / Steam」页一致：默认用已启用国；无启用国时用该页全部配置国。 */
export function dealSyncCountryScopeFromPayload(p: Record<string, unknown>): DealSyncCountryScope {
  return p.countryScope === 'all_configured' ? 'all_configured' : 'enabled';
}

/**
 * 解析折扣同步国家（来源：`region_country_configs`，与 /admin/country-region-mapping 同源）。
 * - 可选 `payload.countries` 显式覆盖；
 * - 默认 `countryScope=enabled`（映射页开关为「启用」的国家）；
 * - 若无任何启用国，回退为映射页全部配置国（`all_configured`）；
 * - `maxCountries`>0 时按主市场优先级截断；`maxCountries=0` 不截断。
 */
export async function resolveCountriesForDealPayload(
  repo: RegionCountryRepository,
  p: Record<string, unknown>,
): Promise<string[]> {
  const explicit = parseCountryList(p.countries);
  if (explicit.length > 0) return explicit;

  const scope = dealSyncCountryScopeFromPayload(p);
  let codes = await resolveDealSyncCountryCodes(repo, scope);
  if (codes.length === 0) {
    codes = await resolveDealSyncCountryCodes(repo, 'all_configured');
  }
  if (codes.length === 0) return ['US'];

  const maxRaw = p.maxCountries;
  const maxN = maxRaw === 0 || maxRaw === '0' ? 0 : Math.trunc(Number(maxRaw ?? 0));
  if (maxN > 0 && codes.length > maxN) {
    codes = prioritizeMarketCountries(codes, maxN);
  }
  return codes;
}
