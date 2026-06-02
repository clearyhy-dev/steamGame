/**
 * 一次性回填：对指定国家跑 market round-robin 直至每国 TopN 或达到 maxRuns。
 *
 *   npx tsx server/scripts/backfill-market-round-robin.ts
 *   npx tsx server/scripts/backfill-market-round-robin.ts --countries=US,GB --topN=200 --maxRuns=50
 */
import { loadEnv } from '../src/config/env';
import { runMarketCountryRoundRobin } from '../src/modules/market/market-round-robin.runner';
import { sqliteCountMarketGamesForCountry } from '../src/storage/sqlite/market-games.store';
import { RegionCountryRepository } from '../src/modules/config/region-country.repository';

async function main() {
  const env = loadEnv();
  const args = process.argv.slice(2);
  const getArg = (key: string) => {
    const hit = args.find((a) => a.startsWith(`--${key}=`));
    return hit ? hit.split('=').slice(1).join('=') : undefined;
  };
  const topN = Math.max(1, Math.min(Number(getArg('topN') ?? 200), 500));
  const batchSize = Math.max(1, Math.min(Number(getArg('batchSize') ?? 50), 200));
  const maxRuns = Math.max(1, Math.min(Number(getArg('maxRuns') ?? 100), 500));
  const delayMs = Math.max(0, Math.min(Number(getArg('delayMs') ?? 50), 3000));

  const repo = new RegionCountryRepository();
  let countries: string[];
  const rawCc = getArg('countries');
  if (rawCc) {
    countries = rawCc
      .split(',')
      .map((x) => x.trim().toUpperCase())
      .filter((x) => /^[A-Z]{2}$/.test(x));
  } else {
    const enabled = await repo.listEnabledPublic();
    countries = enabled.map((r) => r.countryCode.toUpperCase());
  }
  if (countries.length === 0) countries = ['US'];

  console.log(`[backfill-market] countries=${countries.join(',')} topN=${topN} batchSize=${batchSize} maxRuns=${maxRuns}`);

  for (let run = 1; run <= maxRuns; run++) {
    const counts = await Promise.all(countries.map((cc) => sqliteCountMarketGamesForCountry(cc)));
    const allDone = counts.every((n) => n >= topN);
    if (allDone) {
      console.log(`[backfill-market] all countries reached topN=${topN}, stopping at run=${run - 1}`);
      break;
    }
    const r = await runMarketCountryRoundRobin(env, {
      topNPerCountry: topN,
      batchSize,
      delayMs,
      skipSyncedToday: false,
    });
    console.log(`[backfill-market] run=${run} ${r.summary}`);
    if (r.processed === 0 && r.failed > 0) {
      console.warn('[backfill-market] batch had failures with no progress, stopping');
      break;
    }
  }

  for (const cc of countries) {
    const n = await sqliteCountMarketGamesForCountry(cc);
    console.log(`[backfill-market] ${cc}: ${n} games`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
