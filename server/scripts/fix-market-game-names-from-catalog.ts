/**
 * 将 market_games.name 恢复为 game_catalog 中的名称（不被分国 Steam 详情覆盖）。
 *
 *   npx tsx server/scripts/fix-market-game-names-from-catalog.ts
 */
import { loadEnv } from '../src/config/env';
import { GameCatalogRepository } from '../src/modules/game/game-catalog.repository';
import { sqlAll, sqlRun } from '../src/storage/sqlite/sql-client';

async function main() {
  loadEnv();
  const catalog = new GameCatalogRepository();
  const rows = await sqlAll<{ country_code: string; appid: string; name: string }>(
    'SELECT country_code, appid, name FROM market_games',
  );
  let updated = 0;
  for (const row of rows) {
    const doc = await catalog.getByAppid(row.appid);
    const catalogName = String(doc?.name ?? '').trim();
    if (!catalogName || catalogName === row.name) continue;
    await sqlRun('UPDATE market_games SET name = ?, updated_at_ms = ? WHERE country_code = ? AND appid = ?', [
      catalogName,
      Date.now(),
      row.country_code,
      row.appid,
    ]);
    updated += 1;
  }
  console.log(`[fix-market-names] updated=${updated} total=${rows.length}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
