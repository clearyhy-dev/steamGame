/**
 * 对 market_games 中已有游戏强制重拉四平台折扣（含 ITAD/GG API Key）。
 *
 *   npx tsx server/scripts/backfill-market-platform-prices.ts
 *   npx tsx server/scripts/backfill-market-platform-prices.ts --country=US --topN=200 --delayMs=120
 */
import { loadEnv } from '../src/config/env';
import { RegionCountryRepository } from '../src/modules/config/region-country.repository';
import { MarketSyncService } from '../src/modules/market/market-sync.service';
import { sqliteListMarketGames } from '../src/storage/sqlite/market-games.store';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const env = loadEnv();
  const args = process.argv.slice(2);
  const getArg = (key: string) => {
    const hit = args.find((a) => a.startsWith(`--${key}=`));
    return hit ? hit.split('=').slice(1).join('=') : undefined;
  };
  const topN = Math.max(1, Math.min(Number(getArg('topN') ?? 200), 500));
  const batchSize = Math.max(1, Math.min(Number(getArg('batchSize') ?? 50), 200));
  const delayMs = Math.max(0, Math.min(Number(getArg('delayMs') ?? 100), 3000));
  const pricesOnly = getArg('pricesOnly') !== 'false';

  const repo = new RegionCountryRepository();
  let countries: string[];
  const rawCc = getArg('country');
  if (rawCc) {
    countries = rawCc
      .split(',')
      .map((x) => x.trim().toUpperCase())
      .filter((x) => /^[A-Z]{2}$/.test(x));
  } else {
    countries = (await repo.listEnabledPublic()).map((r) => r.countryCode.toUpperCase());
  }
  if (countries.length === 0) countries = ['US'];

  const sync = new MarketSyncService(env);
  console.log(`[backfill-platform-prices] countries=${countries.join(',')} topN=${topN} delayMs=${delayMs}`);

  for (const cc of countries) {
    const { rows } = await sqliteListMarketGames({ countryCode: cc, page: 1, pageSize: topN, sortBy: 'heat_desc' });
    if (rows.length === 0) {
      console.log(`[backfill-platform-prices] ${cc}: no games, skip`);
      continue;
    }
    let ok = 0;
    let failed = 0;
    for (const row of rows) {
      try {
        const r = await sync.syncGameMarket(cc, row.appid, {
          includeDetail: !pricesOnly,
          includeHeat: !pricesOnly,
          includePrices: true,
          forceRefresh: true,
          skipIfSyncedToday: false,
          bulkPricesOnly: pricesOnly,
          delayMs,
        });
        if (r.ok || r.pricesOk) ok++;
        else failed++;
        if ((ok + failed) % 20 === 0) {
          console.log(`[backfill-platform-prices] ${cc} progress ${ok + failed}/${rows.length} ok=${ok} fail=${failed}`);
        }
      } catch (e) {
        failed++;
        console.warn(`[backfill-platform-prices] ${cc} appid=${row.appid} err=${e instanceof Error ? e.message : String(e)}`);
      }
    }
    console.log(`[backfill-platform-prices] ${cc} done ok=${ok} failed=${failed} total=${rows.length}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
