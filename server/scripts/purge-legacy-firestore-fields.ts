/**
 * 物理删除：game_catalog 上的 byCountry、playersDaily、discountUrl；可选清空遗留 game_deal_links。
 *
 *   cd server
 *   npx ts-node --transpile-only scripts/purge-legacy-firestore-fields.ts
 *   npx ts-node --transpile-only scripts/purge-legacy-firestore-fields.ts --legacy-deal-links
 */
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

if (!process.env.JWT_SECRET?.trim()) {
  process.env.JWT_SECRET = '__maintenance_script__';
}

import { loadEnv } from '../src/config/env';
import { getFirestore } from '../src/config/firebase';
import { GameCatalogRepository } from '../src/modules/game/game-catalog.repository';
import { GameDealLinkRepository } from '../src/modules/game/game-deal-link.repository';

async function main(): Promise<void> {
  loadEnv();
  void getFirestore();

  const catalog = new GameCatalogRepository();
  const deals = new GameDealLinkRepository();

  const legacyDealLinks = process.argv.includes('--legacy-deal-links');

  // eslint-disable-next-line no-console
  console.log('Purging game_catalog byCountry + playersDaily + discountUrl...');
  const catOut = await catalog.purgeLegacyCatalogFieldsForAllGames();
  // eslint-disable-next-line no-console
  console.log('Catalog docs touched:', catOut.gamesUpdated);

  if (legacyDealLinks) {
    // eslint-disable-next-line no-console
    console.log('Deleting legacy game_deal_links collection...');
    const linkOut = await deals.deleteLegacyGameDealLinksCollection();
    // eslint-disable-next-line no-console
    console.log('Legacy deal link docs deleted:', linkOut.deleted);
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
