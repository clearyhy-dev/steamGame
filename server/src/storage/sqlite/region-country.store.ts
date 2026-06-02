import admin from 'firebase-admin';
import type { RegionCountryConfigDoc } from '../../modules/config/region-country.repository';
import {
  dealProviderCodesFromSteamCc,
  inferUiLanguage,
} from '../../modules/config/region-country.repository';
import { REGION_COUNTRY_DEFAULTS } from '../../modules/config/region-country.defaults';
import { defaultCurrencySymbol, effectiveCurrencySymbol } from '../../modules/config/currency-symbol.util';
import { sqlAll, sqlGet, sqlRun } from './sql-client';
import { msToTimestamp, nowMs } from './timestamp';

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
    createdAt: msToTimestamp(r.created_at_ms) ?? now,
    updatedAt: msToTimestamp(r.updated_at_ms) ?? now,
  };
}

export async function sqliteListAllRegionCountries(): Promise<RegionCountryConfigDoc[]> {
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
  const row = await sqlGet<RegionRow>('SELECT * FROM region_country_configs WHERE country_code = ?', [c]);
  return row ? rowToDoc(row) : null;
}

export async function sqliteSeedRegionDefaults(): Promise<void> {
  const now = nowMs();
  for (const row of REGION_COUNTRY_DEFAULTS) {
    const prov = dealProviderCodesFromSteamCc(row.steamCc);
    await sqlRun(
      `INSERT INTO region_country_configs (
        country_code, country_name, native_name, steam_cc, itad_country, gg_deals_region, cheapshark_country,
        default_currency, currency_symbol, steam_language, ui_language, enabled, sort_order, created_at_ms, updated_at_ms
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
        now,
        now,
      ],
    );
  }
}

export async function sqliteUpsertRegion(
  input: Partial<RegionCountryConfigDoc> & { countryCode: string },
): Promise<RegionCountryConfigDoc> {
  const code = String(input.countryCode).trim().toUpperCase();
  const prev = await sqliteGetRegionByCode(code);
  const now = nowMs();
  const steamCc = String(input.steamCc ?? prev?.steamCc ?? code).toUpperCase();
  const prov = dealProviderCodesFromSteamCc(steamCc);
  await sqlRun(
    `INSERT INTO region_country_configs (
      country_code, country_name, native_name, steam_cc, itad_country, gg_deals_region, cheapshark_country,
      default_currency, currency_symbol, steam_language, ui_language, enabled, sort_order, created_at_ms, updated_at_ms
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(country_code) DO UPDATE SET
      country_name=excluded.country_name, native_name=excluded.native_name, steam_cc=excluded.steam_cc,
      itad_country=excluded.itad_country, gg_deals_region=excluded.gg_deals_region,
      cheapshark_country=excluded.cheapshark_country, default_currency=excluded.default_currency,
      currency_symbol=excluded.currency_symbol, steam_language=excluded.steam_language,
      ui_language=excluded.ui_language, enabled=excluded.enabled, sort_order=excluded.sort_order,
      updated_at_ms=excluded.updated_at_ms`,
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
      prev ? (prev.createdAt?.toMillis?.() ?? now) : now,
      now,
    ],
  );
  return (await sqliteGetRegionByCode(code))!;
}
