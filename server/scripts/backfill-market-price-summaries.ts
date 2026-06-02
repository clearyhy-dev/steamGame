/**
 * 从已有 detail/prices JSON 重建 market_games.data_json 中的 priceSummary。
 *
 *   npx tsx server/scripts/backfill-market-price-summaries.ts
 *   npx tsx server/scripts/backfill-market-price-summaries.ts --country=GB --limit=500
 */
import { loadEnv } from '../src/config/env';
import { RegionCountryRepository } from '../src/modules/config/region-country.repository';
import { buildMarketGamePriceSummary } from '../src/modules/market/market-price-summary.util';
import type { MarketDetailDoc, MarketPricesDoc } from '../src/modules/market/market.types';
import {
  readMarketJson,
  marketGameDetailPath,
  marketGamePricesPath,
} from '../src/cache/market-object-storage';
import { sqlAll, sqlRun } from '../src/storage/sqlite/sql-client';

async function main() {
  const env = loadEnv();
  const args = process.argv.slice(2);
  const getArg = (key: string) => {
    const hit = args.find((a) => a.startsWith(`--${key}=`));
    return hit ? hit.split('=').slice(1).join('=') : undefined;
  };
  const country = getArg('country')?.trim().toUpperCase();
  const limit = Math.max(1, Math.min(Number(getArg('limit') ?? 5000), 50000));

  type Row = { country_code: string; appid: string; data_json: string };
  const where = country && /^[A-Z]{2}$/.test(country) ? 'WHERE country_code = ?' : '';
  const params = where ? [country, limit] : [limit];
  const rows = await sqlAll<Row>(
    `SELECT country_code, appid, data_json FROM market_games ${where} ORDER BY country_code, appid LIMIT ?`,
    params,
  );

  const repo = new RegionCountryRepository();
  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const existing = JSON.parse(row.data_json || '{}') as { priceSummary?: { platforms?: Record<string, { finalPrice?: number | null }> } };
      const ps = existing.priceSummary;
      const needsRebuild =
        !ps ||
        !ps.platforms ||
        (ps.platforms.isthereanydeal?.finalPrice == null &&
          ps.platforms.ggdeals?.finalPrice == null &&
          ps.platforms.cheapshark?.finalPrice == null);
      if (!needsRebuild) {
        skipped += 1;
        continue;
      }
    } catch {
      /* continue rebuild */
    }

    const cc = row.country_code;
    const appid = row.appid;
    const resolved = await repo.resolveForRegionalDetail(cc);
    const [detail, prices] = await Promise.all([
      readMarketJson<MarketDetailDoc>(env, marketGameDetailPath(cc, appid)),
      readMarketJson<MarketPricesDoc>(env, marketGamePricesPath(cc, appid)),
    ]);
    if (!detail && !prices?.bucket) {
      skipped += 1;
      continue;
    }
    const priceSummary = buildMarketGamePriceSummary({
      countryCode: cc,
      appid,
      resolved,
      bucket: prices?.bucket ?? null,
      detail,
    });
    await sqlRun(
      `UPDATE market_games SET
        discount_percent = ?,
        final_price = ?,
        data_json = ?,
        updated_at_ms = ?
      WHERE country_code = ? AND appid = ?`,
      [
        priceSummary.discountPercent ?? 0,
        priceSummary.finalPrice,
        JSON.stringify({ priceSummary }),
        Date.now(),
        cc,
        appid,
      ],
    );
    updated += 1;
    if (updated % 50 === 0) console.log(`[backfill-price-summary] updated=${updated}`);
  }

  console.log(`[backfill-price-summary] done updated=${updated} skipped=${skipped} scanned=${rows.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
