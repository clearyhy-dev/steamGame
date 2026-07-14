import admin from 'firebase-admin';
import type { RegionCountryConfigDoc } from '../../modules/config/region-country.repository';
import {
  dealProviderCodesFromSteamCc,
  inferUiLanguage,
} from '../../modules/config/region-country.repository';
import { REGION_COUNTRY_DEFAULTS } from '../../modules/config/region-country.defaults';
import { defaultCurrencySymbol, effectiveCurrencySymbol } from '../../modules/config/currency-symbol.util';
import { DEFAULT_T1_COUNTRY_CODES, normalizeMarketSyncTier } from '../../modules/config/market-sync-tier.config';
import { sqlAll, sqlGet, sqlRun } from './sql-client';
import { msToTimestamp, nowMs } from './timestamp';
import { logger } from '../../utils/logger';

type RegionRow = {
  country_code: string;
  country_name: string;
  native_name: string | null;
  steam_cc: string;
  itad_country: string | null;
  gg_deals_region: string | null;
  cheapshark_country: string | null;
  default_currency: string;
  currency_symbol: string;
  steam_language: string;
  ui_language: string;
  enabled: number;
  sort_order: number;
  sync_tier?: string | null;
  created_at_ms: number;
  updated_at_ms: number;
};

function rowToDoc(r: RegionRow): RegionCountryConfigDoc {
  const now = admin.firestore.Timestamp.now();
  return {
    countryCode: r.country_code,
    countryName: r.country_name,
    nativeName: r.native_name ?? undefined,
    steamCc: r.steam_cc,
    itadCountry: r.itad_country ?? undefined,
    ggDealsRegion: r.gg_deals_region ?? undefined,
    cheapsharkCountry: r.cheapshark_country ?? undefined,
    defaultCurrency: r.default_currency,
    currencySymbol: r.currency_symbol,
    steamLanguage: r.steam_language,
    uiLanguage: r.ui_language,
    enabled: r.enabled === 1,
    sortOrder: r.sort_order,
    syncTier: normalizeMarketSyncTier(r.sync_tier ?? 'T2'),
    createdAt: msToTimestamp(r.created_at_ms) ?? now,
    updatedAt: msToTimestamp(r.updated_at_ms) ?? now,
  };
}

let syncTierColumnEnsured = false;

export async function sqliteEnsureRegionSyncTierColumn(): Promise<void> {
  if (syncTierColumnEnsured) return;
  const cols = await sqlGet<{ n: number }>(
    "SELECT COUNT(*) AS n FROM pragma_table_info('region_country_configs') WHERE name='sync_tier'",
  );
  if ((cols?.n ?? 0) === 0) {
    try {
      await sqlRun(`ALTER TABLE region_country_configs ADD COLUMN sync_tier TEXT NOT NULL DEFAULT 'T2'`);
      logger.info('[region-country] sync_tier column added');
    } catch (e) {
      logger.warn(`[region-country] sync_tier migrate: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  syncTierColumnEnsured = true;
}

export async function sqliteBackfillDefaultSyncTiers(force = false): Promise<{ updated: number }> {
  await sqliteEnsureRegionSyncTierColumn();
  const seeded = await sqlGet<{ value: string }>(
    "SELECT value FROM config_runtime WHERE key = 'market_sync_tier_countries_seeded'",
  );
  if (!force && seeded?.value === '1') return { updated: 0 };

  const rows = await sqlAll<RegionRow>('SELECT country_code FROM region_country_configs');
  let updated = 0;
  const now = nowMs();
  for (const row of rows) {
    const cc = row.country_code.toUpperCase();
    const want = DEFAULT_T1_COUNTRY_CODES.has(cc) ? 'T1' : 'T2';
    await sqlRun('UPDATE region_country_configs SET sync_tier = ?, updated_at_ms = ? WHERE country_code = ?', [
      want,
      now,
      cc,
    ]);
    updated++;
  }
  await sqlRun(
    `INSERT INTO config_runtime (key, value) VALUES ('market_sync_tier_countries_seeded','1')
     ON CONFLICT(key) DO UPDATE SET value='1'`,
  );
  if (updated > 0) {
    logger.info(`[region-country] sync_tier seed updated=${updated} force=${force}`);
  }
  return { updated };
}

export async function sqliteListAllRegionCountries(): Promise<RegionCountryConfigDoc[]> {
  await sqliteEnsureRegionSyncTierColumn();
  await sqliteBackfillDefaultSyncTiers(false);
  const rows = await sqlAll<RegionRow>(
    'SELECT * FROM region_country_configs ORDER BY sort_order ASC, country_code ASC',
  );
  if (rows.length === 0) {
    await sqliteSeedRegionDefaults();
    return sqliteListAllRegionCountries();
  }
  return rows.map(rowToDoc);
}

export async function sqliteListEnabledRegionCountries(): Promise<RegionCountryConfigDoc[]> {
  const all = await sqliteListAllRegionCountries();
  return all.filter((r) => r.enabled);
}

export async function sqliteGetRegionByCode(code: string): Promise<RegionCountryConfigDoc | null> {
  const c = String(code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return null;
  await sqliteEnsureRegionSyncTierColumn();
  const row = await sqlGet<RegionRow>('SELECT * FROM region_country_configs WHERE country_code = ?', [c]);
  return row ? rowToDoc(row) : null;
}

export async function sqliteSeedRegionDefaults(): Promise<void> {
  await sqliteEnsureRegionSyncTierColumn();
  const now = nowMs();
  for (const row of REGION_COUNTRY_DEFAULTS) {
    const prov = dealProviderCodesFromSteamCc(row.steamCc);
    const tier = DEFAULT_T1_COUNTRY_CODES.has(row.countryCode) ? 'T1' : 'T2';
    await sqlRun(
      `INSERT INTO region_country_configs (
        country_code, country_name, native_name, steam_cc, itad_country, gg_deals_region, cheapshark_country,
        default_currency, currency_symbol, steam_language, ui_language, enabled, sort_order, sync_tier, created_at_ms, updated_at_ms
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(country_code) DO NOTHING`,
      [
        row.countryCode,
        row.countryName,
        row.nativeName ?? '',
        row.steamCc,
        prov.itadCountry,
        prov.ggDealsRegion,
        prov.cheapsharkCountry,
        row.defaultCurrency,
        row.currencySymbol || defaultCurrencySymbol(row.defaultCurrency),
        row.steamLanguage,
        inferUiLanguage(row),
        1,
        row.sortOrder,
        tier,
        now,
        now,
      ],
    );
  }
}

export async function sqliteUpsertRegion(
  input: Partial<RegionCountryConfigDoc> & { countryCode: string },
): Promise<RegionCountryConfigDoc> {
  await sqliteEnsureRegionSyncTierColumn();
  const code = String(input.countryCode).trim().toUpperCase();
  const prev = await sqliteGetRegionByCode(code);
  const now = nowMs();
  const steamCc = String(input.steamCc ?? prev?.steamCc ?? code).toUpperCase();
  const prov = dealProviderCodesFromSteamCc(steamCc);
  const syncTier =
    input.syncTier !== undefined
      ? normalizeMarketSyncTier(input.syncTier)
      : normalizeMarketSyncTier(prev?.syncTier ?? (DEFAULT_T1_COUNTRY_CODES.has(code) ? 'T1' : 'T2'));
  await sqlRun(
    `INSERT INTO region_country_configs (
      country_code, country_name, native_name, steam_cc, itad_country, gg_deals_region, cheapshark_country,
      default_currency, currency_symbol, steam_language, ui_language, enabled, sort_order, sync_tier, created_at_ms, updated_at_ms
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(country_code) DO UPDATE SET
      country_name=excluded.country_name, native_name=excluded.native_name, steam_cc=excluded.steam_cc,
      itad_country=excluded.itad_country, gg_deals_region=excluded.gg_deals_region,
      cheapshark_country=excluded.cheapshark_country, default_currency=excluded.default_currency,
      currency_symbol=excluded.currency_symbol, steam_language=excluded.steam_language,
      ui_language=excluded.ui_language, enabled=excluded.enabled, sort_order=excluded.sort_order,
      sync_tier=excluded.sync_tier, updated_at_ms=excluded.updated_at_ms`,
    [
      code,
      input.countryName ?? prev?.countryName ?? code,
      input.nativeName ?? prev?.nativeName ?? '',
      steamCc,
      input.itadCountry !== undefined ? input.itadCountry : (prev?.itadCountry ?? prov.itadCountry),
      input.ggDealsRegion !== undefined ? input.ggDealsRegion : (prev?.ggDealsRegion ?? prov.ggDealsRegion),
      input.cheapsharkCountry !== undefined
        ? input.cheapsharkCountry
        : (prev?.cheapsharkCountry ?? prov.cheapsharkCountry),
      input.defaultCurrency ?? prev?.defaultCurrency ?? 'USD',
      effectiveCurrencySymbol(
        input.defaultCurrency ?? prev?.defaultCurrency ?? 'USD',
        input.currencySymbol ?? prev?.currencySymbol,
      ),
      input.steamLanguage ?? prev?.steamLanguage ?? 'en',
      input.uiLanguage ?? prev?.uiLanguage ?? inferUiLanguage({ countryCode: code, steamLanguage: 'en' }),
      (input.enabled ?? prev?.enabled ?? true) ? 1 : 0,
      input.sortOrder ?? prev?.sortOrder ?? 0,
      syncTier,
      prev ? (prev.createdAt?.toMillis?.() ?? now) : now,
      now,
    ],
  );
  return (await sqliteGetRegionByCode(code))!;
}
