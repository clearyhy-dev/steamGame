/**
 * 修正 market_games 表中误存为 `$` 的 currency_symbol。
 *
 *   npx tsx server/scripts/backfill-market-currency-symbols.ts
 */
import { loadEnv } from '../src/config/env';
import { RegionCountryRepository } from '../src/modules/config/region-country.repository';
import { effectiveCurrencySymbol } from '../src/modules/config/currency-symbol.util';
import { sqlAll, sqlRun } from '../src/storage/sqlite/sql-client';

async function main() {
  loadEnv();
  const repo = new RegionCountryRepository();
  const symFix = await repo.backfillCurrencySymbols(true);
  console.log(`[backfill-currency] region_country_configs updated=${symFix.updated}`);

  type Row = { country_code: string; currency: string; currency_symbol: string };
  const rows = await sqlAll<Row>('SELECT DISTINCT country_code, currency, currency_symbol FROM market_games');
  let updated = 0;
  for (const r of rows) {
    const resolved = await repo.resolveForRegionalDetail(r.country_code);
    const next = effectiveCurrencySymbol(resolved.defaultCurrency, resolved.currencySymbol);
    if (next === r.currency_symbol && resolved.defaultCurrency === r.currency) continue;
    await sqlRun(
      'UPDATE market_games SET currency = ?, currency_symbol = ? WHERE country_code = ?',
      [resolved.defaultCurrency, next, r.country_code],
    );
    updated += 1;
    console.log(`[backfill-currency] ${r.country_code} -> ${resolved.defaultCurrency} ${next}`);
  }
  console.log(`[backfill-currency] market_games countries patched=${updated}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
