/**
 * 将 market_games.name 恢复为 game_catalog 或 Steam 详情中的名称。
 *
 *   npx tsx server/scripts/fix-market-game-names-from-catalog.ts
 *   npx tsx server/scripts/fix-market-game-names-from-catalog.ts --country=BR
 */
import { loadEnv } from '../src/config/env';
import { GameCatalogRepository } from '../src/modules/game/game-catalog.repository';
import { SteamStoreService } from '../src/modules/steam/steam-store.service';
import { RegionCountryRepository } from '../src/modules/config/region-country.repository';
import { isPlaceholderMarketName } from '../src/modules/market/market-name.util';
import { sqlAll, sqlRun } from '../src/storage/sqlite/sql-client';

async function main() {
  const env = loadEnv();
  const catalog = new GameCatalogRepository();
  const store = new SteamStoreService(env);
  const regions = new RegionCountryRepository();
  const countryArg = process.argv.find((a) => a.startsWith('--country='));
  const countryFilter = countryArg ? countryArg.split('=')[1]?.trim().toUpperCase() : null;

  const rows = await sqlAll<{ country_code: string; appid: string; name: string }>(
    countryFilter
      ? 'SELECT country_code, appid, name FROM market_games WHERE country_code = ?'
      : 'SELECT country_code, appid, name FROM market_games',
    countryFilter ? [countryFilter] : [],
  );

  let updated = 0;
  let skipped = 0;
  const regionCache = new Map<string, Awaited<ReturnType<RegionCountryRepository['resolveForRegionalDetail']>>>();

  for (const row of rows) {
    if (!isPlaceholderMarketName(row.name, row.appid)) {
      skipped += 1;
      continue;
    }
    const doc = await catalog.getByAppid(row.appid);
    let nextName = String(doc?.name ?? '').trim();
    if (!nextName || isPlaceholderMarketName(nextName, row.appid)) {
      const cc = row.country_code.trim().toUpperCase();
      let resolved = regionCache.get(cc);
      if (!resolved) {
        resolved = await regions.resolveForRegionalDetail(cc);
        regionCache.set(cc, resolved);
      }
      const detail = await store.fetchAppDetails(row.appid, {
        cc: resolved.steamCc,
        language: resolved.steamLanguage,
      });
      nextName = String(detail?.name ?? '').trim();
    }
    if (!nextName || isPlaceholderMarketName(nextName, row.appid) || nextName === row.name) {
      skipped += 1;
      continue;
    }
    await sqlRun('UPDATE market_games SET name = ?, updated_at_ms = ? WHERE country_code = ? AND appid = ?', [
      nextName,
      Date.now(),
      row.country_code,
      row.appid,
    ]);
    updated += 1;
    if (updated % 25 === 0) console.log(`[fix-market-names] progress updated=${updated}`);
  }
  console.log(`[fix-market-names] updated=${updated} skipped=${skipped} total=${rows.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
