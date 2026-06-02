/**
 * 清空 game_discount_offers + catalog 废弃字段，再按四平台各跑一轮「今日有折」Top1000。
 * 需要：server/.env（或环境变量）中 Firebase 与 GOOGLE_APPLICATION_CREDENTIALS 等，与本地跑 API 相同。
 *
 *   cd server
 *   npx ts-node --transpile-only scripts/full-deal-reset-resync.ts
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

// loadEnv() 要求 JWT_SECRET；本脚本只访问 Firestore，与 API 密钥无关。
if (!process.env.JWT_SECRET?.trim()) {
  process.env.JWT_SECRET = '__maintenance_script__';
}

import { loadEnv } from '../src/config/env';
import { getFirestore } from '../src/config/firebase';
import { GameDealLinkRepository } from '../src/modules/game/game-deal-link.repository';
import { GameCatalogRepository } from '../src/modules/game/game-catalog.repository';
import { DealSyncBatchService } from '../src/modules/game/deal-sync-batch.service';

async function main(): Promise<void> {
  const env = loadEnv();
  void getFirestore();

  const deals = new GameDealLinkRepository();
  const catalog = new GameCatalogRepository();
  const dealBatch = new DealSyncBatchService(env);

  // eslint-disable-next-line no-console
  console.log('Deleting all game_deal_links...');
  const linkOut = await deals.deleteAllDealLinks();
  // eslint-disable-next-line no-console
  console.log('Deleted deal link docs:', linkOut.deleted);

  // eslint-disable-next-line no-console
  console.log('Purging legacy catalog fields...');
  const catOut = await catalog.purgeLegacyCatalogFieldsForAllGames();
  // eslint-disable-next-line no-console
  console.log('Catalog games touched:', catOut.gamesUpdated);

  const PLATFORM_SOURCES = ['steam', 'isthereanydeal', 'ggdeals', 'cheapshark'] as const;
  for (const source of PLATFORM_SOURCES) {
    // eslint-disable-next-line no-console
    console.log(`Running daily top sync: ${source}...`);
    const out = await dealBatch.runDailyTopHotDealsSync({
      topN: 1000,
      chunkSize: 200,
      delayMs: 50,
      staleTtlHours: 6,
      sortByDiscountHeat: true,
      todayDiscountOnly: true,
      sources: [source],
      countryScope: 'all_configured',
    });
    // eslint-disable-next-line no-console
    console.log(source, {
      total: out.total,
      success: out.success,
      failed: out.failed,
      staleMarked: out.staleMarked,
      coverage: out.coverage,
    });
  }
  // eslint-disable-next-line no-console
  console.log('Done.');
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
