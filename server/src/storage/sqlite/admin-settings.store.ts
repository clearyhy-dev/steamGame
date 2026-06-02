import admin from 'firebase-admin';
import type {
  DiscountProvidersConfig,
  RuntimeConfigDoc,
} from '../../modules/admin/admin.settings.repository';
import { RUNTIME_OVERRIDE_KEYS } from '../../modules/admin/admin.settings.repository';
import { sqlGet, sqlRun, sqlAll } from './sql-client';
import { msToTimestamp, nowMs } from './timestamp';

type DiscountRow = {
  id: number;
  itad_api_key: string;
  gg_deals_api_key: string;
  steam_api_key: string;
  itad_base_url: string;
  gg_deals_base_url: string;
  cheap_shark_base_url: string;
  steam_web_api_base_url: string;
  steam_store_base_url: string;
  created_at_ms: number;
  updated_at_ms: number;
};

function rowToDiscount(r: DiscountRow): DiscountProvidersConfig {
  const now = admin.firestore.Timestamp.now();
  return {
    itadApiKey: r.itad_api_key,
    ggDealsApiKey: r.gg_deals_api_key,
    steamApiKey: r.steam_api_key,
    itadBaseUrl: r.itad_base_url,
    ggDealsBaseUrl: r.gg_deals_base_url,
    cheapSharkBaseUrl: r.cheap_shark_base_url,
    steamWebApiBaseUrl: r.steam_web_api_base_url,
    steamStoreBaseUrl: r.steam_store_base_url,
    createdAt: msToTimestamp(r.created_at_ms) ?? now,
    updatedAt: msToTimestamp(r.updated_at_ms) ?? now,
  };
}

export async function sqliteGetDiscountProviders(): Promise<DiscountProvidersConfig> {
  let row = await sqlGet<DiscountRow>('SELECT * FROM config_discount_providers WHERE id = 1');
  if (!row) {
    const now = nowMs();
    await sqlRun(
      `INSERT INTO config_discount_providers (
        id, itad_api_key, gg_deals_api_key, steam_api_key,
        itad_base_url, gg_deals_base_url, cheap_shark_base_url, steam_web_api_base_url, steam_store_base_url,
        created_at_ms, updated_at_ms
      ) VALUES (1,'','','','https://api.isthereanydeal.com','https://api.gg.deals','https://www.cheapshark.com/api/1.0','https://api.steampowered.com','https://store.steampowered.com',?,?)`,
      [now, now],
    );
    row = await sqlGet<DiscountRow>('SELECT * FROM config_discount_providers WHERE id = 1');
  }
  return rowToDiscount(row!);
}

export async function sqlitePatchDiscountProviders(
  patch: Partial<Omit<DiscountProvidersConfig, 'updatedAt' | 'createdAt'>>,
): Promise<DiscountProvidersConfig> {
  const cur = await sqliteGetDiscountProviders();
  const now = nowMs();
  await sqlRun(
    `UPDATE config_discount_providers SET
      itad_api_key=?, gg_deals_api_key=?, steam_api_key=?,
      itad_base_url=?, gg_deals_base_url=?, cheap_shark_base_url=?,
      steam_web_api_base_url=?, steam_store_base_url=?, updated_at_ms=?
     WHERE id=1`,
    [
      patch.itadApiKey ?? cur.itadApiKey,
      patch.ggDealsApiKey ?? cur.ggDealsApiKey,
      patch.steamApiKey ?? cur.steamApiKey,
      patch.itadBaseUrl ?? cur.itadBaseUrl,
      patch.ggDealsBaseUrl ?? cur.ggDealsBaseUrl,
      patch.cheapSharkBaseUrl ?? cur.cheapSharkBaseUrl,
      patch.steamWebApiBaseUrl ?? cur.steamWebApiBaseUrl,
      patch.steamStoreBaseUrl ?? cur.steamStoreBaseUrl,
      now,
    ],
  );
  return sqliteGetDiscountProviders();
}

export async function sqliteGetRuntime(): Promise<Partial<RuntimeConfigDoc>> {
  const rows = await sqlAll<{ key: string; value: string }>('SELECT key, value FROM config_runtime');
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    if (!RUNTIME_OVERRIDE_KEYS.includes(r.key as keyof RuntimeConfigDoc)) continue;
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      out[r.key] = r.value;
    }
  }
  return out as Partial<RuntimeConfigDoc>;
}

export async function sqlitePatchRuntime(
  patch: Record<string, unknown>,
): Promise<{ stored: Partial<RuntimeConfigDoc>; updatedAt: admin.firestore.Timestamp }> {
  const now = admin.firestore.Timestamp.now();
  for (const [key, val] of Object.entries(patch)) {
    if (!RUNTIME_OVERRIDE_KEYS.includes(key as keyof RuntimeConfigDoc)) continue;
    if (val === undefined) continue;
    if (val === null || val === '') {
      await sqlRun('DELETE FROM config_runtime WHERE key = ?', [key]);
      continue;
    }
    const stored = typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' ? String(val) : JSON.stringify(val);
    await sqlRun(
      `INSERT INTO config_runtime (key, value) VALUES (?,?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      [key, stored],
    );
  }
  const stored = await sqliteGetRuntime();
  return { stored, updatedAt: now };
}
