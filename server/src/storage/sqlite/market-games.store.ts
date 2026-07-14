import { sqlAll, sqlGet, sqlRun } from './sql-client';
import { nowMs } from './timestamp';
import type { MarketGameRow } from '../../modules/market/market.types';
import { parseMarketGamePriceSummary } from '../../modules/market/market-price-summary.util';

type MarketGameDbRow = {
  country_code: string;
  appid: string;
  name: string;
  currency: string;
  currency_symbol: string;
  current_players: number;
  discount_percent: number;
  final_price: number | null;
  heat_score: number;
  detail_synced_at_ms: number | null;
  price_synced_at_ms: number | null;
  detail_json_path: string | null;
  heat_json_path: string | null;
  prices_json_path: string | null;
  data_json: string;
  created_at_ms: number;
  updated_at_ms: number;
};

function parseDataJson(raw: string | null | undefined): { priceSummary: MarketGameRow['priceSummary'] } {
  if (!raw) return { priceSummary: null };
  try {
    const o = JSON.parse(raw) as { priceSummary?: unknown };
    return { priceSummary: parseMarketGamePriceSummary(o.priceSummary) };
  } catch {
    return { priceSummary: null };
  }
}

function rowToMarket(r: MarketGameDbRow): MarketGameRow {
  const { priceSummary } = parseDataJson(r.data_json);
  const originalPrice = priceSummary?.originalPrice ?? null;
  const finalPrice = priceSummary?.finalPrice ?? r.final_price;
  const discountPercent = priceSummary?.discountPercent ?? r.discount_percent;
  return {
    countryCode: r.country_code,
    appid: r.appid,
    name: r.name,
    currency: r.currency,
    currencySymbol: r.currency_symbol,
    currentPlayers: r.current_players,
    discountPercent,
    originalPrice,
    finalPrice,
    heatScore: r.heat_score,
    detailSyncedAtMs: r.detail_synced_at_ms,
    priceSyncedAtMs: r.price_synced_at_ms,
    detailJsonPath: r.detail_json_path ?? '',
    heatJsonPath: r.heat_json_path ?? '',
    pricesJsonPath: r.prices_json_path ?? '',
    priceSummary,
  };
}

export async function sqliteUpsertMarketGame(row: MarketGameRow): Promise<void> {
  const now = nowMs();
  const cc = row.countryCode.toUpperCase();
  const dataJson = JSON.stringify({ priceSummary: row.priceSummary ?? null });
  await sqlRun(
    `INSERT INTO market_games (
      country_code, appid, name, currency, currency_symbol, current_players, discount_percent,
      final_price, heat_score, detail_synced_at_ms, price_synced_at_ms,
      detail_json_path, heat_json_path, prices_json_path, data_json, created_at_ms, updated_at_ms
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(country_code, appid) DO UPDATE SET
      name=excluded.name, currency=excluded.currency, currency_symbol=excluded.currency_symbol,
      current_players=excluded.current_players, discount_percent=excluded.discount_percent,
      final_price=excluded.final_price, heat_score=excluded.heat_score,
      detail_synced_at_ms=excluded.detail_synced_at_ms, price_synced_at_ms=excluded.price_synced_at_ms,
      detail_json_path=excluded.detail_json_path, heat_json_path=excluded.heat_json_path,
      prices_json_path=excluded.prices_json_path, data_json=excluded.data_json, updated_at_ms=excluded.updated_at_ms`,
    [
      cc,
      row.appid,
      row.name,
      row.currency,
      row.currencySymbol,
      row.currentPlayers,
      row.discountPercent,
      row.finalPrice,
      row.heatScore,
      row.detailSyncedAtMs,
      row.priceSyncedAtMs,
      row.detailJsonPath,
      row.heatJsonPath,
      row.pricesJsonPath,
      dataJson,
      now,
      now,
    ],
  );
}

export async function sqliteGetMarketGame(countryCode: string, appid: string): Promise<MarketGameRow | null> {
  const row = await sqlGet<MarketGameDbRow>(
    'SELECT * FROM market_games WHERE country_code = ? AND appid = ?',
    [countryCode.toUpperCase(), appid],
  );
  return row ? rowToMarket(row) : null;
}

export async function sqliteListMarketGames(params: {
  countryCode: string;
  page?: number;
  pageSize?: number;
  sortBy?: 'online_desc' | 'heat_desc' | 'discount_desc';
}): Promise<{ rows: MarketGameRow[]; total: number }> {
  const cc = params.countryCode.toUpperCase();
  const pageSize = Math.max(1, Math.min(params.pageSize ?? 50, 200));
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const offset = (page - 1) * pageSize;
  let order = 'current_players DESC, appid ASC';
  if (params.sortBy === 'heat_desc') order = 'heat_score DESC, current_players DESC, appid ASC';
  else if (params.sortBy === 'discount_desc') order = 'discount_percent DESC, current_players DESC, appid ASC';
  const countRow = await sqlGet<{ n: number }>(
    'SELECT COUNT(*) AS n FROM market_games WHERE country_code = ?',
    [cc],
  );
  const rows = await sqlAll<MarketGameDbRow>(
    `SELECT * FROM market_games WHERE country_code = ? ORDER BY ${order} LIMIT ? OFFSET ?`,
    [cc, pageSize, offset],
  );
  return { rows: rows.map(rowToMarket), total: Number(countRow?.n ?? 0) };
}

export async function sqliteCountMarketGamesForCountry(countryCode: string): Promise<number> {
  const row = await sqlGet<{ n: number }>(
    'SELECT COUNT(*) AS n FROM market_games WHERE country_code = ?',
    [countryCode.toUpperCase()],
  );
  return Number(row?.n ?? 0);
}

export async function sqliteIsMarketGameFullySyncedToday(
  countryCode: string,
  appid: string,
  dayStartMs: number,
  opts?: { pricesOnly?: boolean },
): Promise<boolean> {
  const row = await sqlGet<{ detail_synced_at_ms: number | null; price_synced_at_ms: number | null }>(
    'SELECT detail_synced_at_ms, price_synced_at_ms FROM market_games WHERE country_code = ? AND appid = ?',
    [countryCode.toUpperCase(), appid],
  );
  if (opts?.pricesOnly) {
    return !!row?.price_synced_at_ms && row.price_synced_at_ms >= dayStartMs;
  }
  if (!row?.detail_synced_at_ms || !row?.price_synced_at_ms) return false;
  return row.detail_synced_at_ms >= dayStartMs && row.price_synced_at_ms >= dayStartMs;
}
