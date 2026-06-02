/**
 * 将 Firestore 中的配置/用户/国家/Steam 数据迁入 Vultr SQLite（不迁移游戏目录与折扣）。
 *
 * 前置：GOOGLE_APPLICATION_CREDENTIALS、SQLITE_API_URL、DATA_API_SECRET
 * 用法：npx ts-node scripts/migrate-config-to-sqlite.ts
 */
import admin from 'firebase-admin';
import { serializeForSqlite } from '../src/storage/vultr-db/serialize';
import { loadEnv } from '../src/config/env';

const CONFIG_COLLECTIONS = {
  users: 'users',
  region: 'region_country_configs',
  discount: { collection: 'system_config', doc: 'discount_providers' },
  runtime: { collection: 'system_config', doc: 'runtime' },
  scheduled: { collection: 'system_config', doc: 'scheduled_tasks' },
  steamProfile: 'steam_profiles',
  steamFriends: 'steam_friends_cache',
  steamOwned: 'steam_games_owned_cache',
  steamRecent: 'steam_games_recent_cache',
} as const;

function tsMs(val: unknown): number | null {
  if (val == null || typeof val !== 'object') return null;
  const o = val as Record<string, unknown>;
  if (o._firestore_timestamp === true && typeof o.seconds === 'number') {
    return o.seconds * 1000;
  }
  if (typeof o._seconds === 'number') return o._seconds * 1000;
  if (typeof o.seconds === 'number') return o.seconds * 1000;
  return null;
}

async function migrateDocCollection(
  db: admin.firestore.Firestore,
  apiBase: string,
  headers: Record<string, string>,
  firestoreCollection: string,
  sqliteTable: string,
  mapRow: (id: string, data: Record<string, unknown>) => { sql: string; params: unknown[] },
): Promise<number> {
  let total = 0;
  let lastId: string | undefined;
  while (true) {
    let q = db.collection(firestoreCollection).orderBy(admin.firestore.FieldPath.documentId()).limit(300);
    if (lastId) q = q.startAfter(lastId);
    const snap = await q.get();
    if (snap.empty) break;
    for (const d of snap.docs) {
      const data = serializeForSqlite(d.data()) as Record<string, unknown>;
      const { sql, params } = mapRow(d.id, data);
      await fetch(`${apiBase}/v1/sql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ sql, params, mode: 'run' }),
      }).then(async (r) => {
        if (!r.ok) throw new Error(`${sqliteTable} ${d.id}: ${await r.text()}`);
      });
      total += 1;
    }
    lastId = snap.docs[snap.docs.length - 1].id;
    // eslint-disable-next-line no-console
    console.log(`[migrate] ${sqliteTable} +${snap.size} (total ${total})`);
    if (snap.size < 300) break;
  }
  return total;
}

async function migrateSingleDoc(
  db: admin.firestore.Firestore,
  apiBase: string,
  headers: Record<string, string>,
  collection: string,
  docId: string,
  handlers: (data: Record<string, unknown>) => Promise<void>,
): Promise<void> {
  const snap = await db.collection(collection).doc(docId).get();
  if (!snap.exists) return;
  const data = serializeForSqlite(snap.data()) as Record<string, unknown>;
  await handlers(data);
  // eslint-disable-next-line no-console
  console.log(`[migrate] ${collection}/${docId} ok`);
}

async function main(): Promise<void> {
  const env = loadEnv();
  const apiBase = (env.sqliteApiUrl ?? '').replace(/\/+$/, '');
  if (!apiBase) throw new Error('SQLITE_API_URL required');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (env.sqliteApiSecret) headers['X-Data-Api-Secret'] = env.sqliteApiSecret;

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: env.firebaseProjectId,
      credential: admin.credential.applicationDefault(),
    });
  }
  const db = admin.firestore();
  db.settings({ preferRest: true });
  const now = Date.now();

  await migrateDocCollection(db, apiBase, headers, CONFIG_COLLECTIONS.users, 'users', (id, data) => ({
    sql: `INSERT INTO users (
      id, email, password_hash, display_name, avatar_url, auth_providers_json, admin_note, disabled,
      steam_id, steam_persona_name, steam_avatar, steam_profile_url, registered_at_ms, created_at_ms, updated_at_ms
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET email=excluded.email, updated_at_ms=excluded.updated_at_ms`,
    params: [
      id,
      data.email ?? null,
      data.passwordHash ?? null,
      data.displayName ?? null,
      data.avatarUrl ?? null,
      JSON.stringify(data.authProviders ?? []),
      data.adminNote ?? null,
      data.disabled ? 1 : 0,
      data.steamId ?? null,
      data.steamPersonaName ?? null,
      data.steamAvatar ?? null,
      data.steamProfileUrl ?? null,
      tsMs(data.registeredAt),
      tsMs(data.createdAt) ?? now,
      tsMs(data.updatedAt) ?? now,
    ],
  }));

  await migrateDocCollection(db, apiBase, headers, CONFIG_COLLECTIONS.region, 'region_country_configs', (id, data) => ({
    sql: `INSERT INTO region_country_configs (
      country_code, country_name, native_name, steam_cc, itad_country, gg_deals_region, cheapshark_country,
      default_currency, currency_symbol, steam_language, ui_language, enabled, sort_order, created_at_ms, updated_at_ms
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(country_code) DO UPDATE SET country_name=excluded.country_name, updated_at_ms=excluded.updated_at_ms`,
    params: [
      id,
      data.countryName,
      data.nativeName ?? '',
      data.steamCc,
      data.itadCountry ?? '',
      data.ggDealsRegion ?? '',
      data.cheapsharkCountry ?? '',
      data.defaultCurrency,
      data.currencySymbol,
      data.steamLanguage,
      data.uiLanguage,
      data.enabled === false ? 0 : 1,
      data.sortOrder ?? 0,
      tsMs(data.createdAt) ?? now,
      tsMs(data.updatedAt) ?? now,
    ],
  }));

  await migrateSingleDoc(db, apiBase, headers, 'system_config', 'discount_providers', async (data) => {
    await fetch(`${apiBase}/v1/sql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sql: `INSERT INTO config_discount_providers (
          id, itad_api_key, gg_deals_api_key, steam_api_key, itad_base_url, gg_deals_base_url, cheap_shark_base_url,
          steam_web_api_base_url, steam_store_base_url, created_at_ms, updated_at_ms
        ) VALUES (1,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET steam_api_key=excluded.steam_api_key, updated_at_ms=excluded.updated_at_ms`,
        params: [
          data.itadApiKey ?? '',
          data.ggDealsApiKey ?? '',
          data.steamApiKey ?? '',
          data.itadBaseUrl ?? '',
          data.ggDealsBaseUrl ?? '',
          data.cheapSharkBaseUrl ?? '',
          data.steamWebApiBaseUrl ?? '',
          data.steamStoreBaseUrl ?? '',
          tsMs(data.createdAt) ?? now,
          tsMs(data.updatedAt) ?? now,
        ],
        mode: 'run',
      }),
    });
  });

  await migrateSingleDoc(db, apiBase, headers, 'system_config', 'runtime', async (data) => {
    const keys = Object.keys(data).filter((k) => !['createdAt', 'updatedAt'].includes(k));
    for (const key of keys) {
      const val = data[key];
      if (val === undefined) continue;
      await fetch(`${apiBase}/v1/sql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sql: `INSERT INTO config_runtime (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
          params: [key, typeof val === 'object' ? JSON.stringify(val) : String(val)],
          mode: 'run',
        }),
      });
    }
  });

  await migrateSingleDoc(db, apiBase, headers, 'system_config', 'scheduled_tasks', async (data) => {
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    const created = tsMs(data.createdAt) ?? now;
    const updated = tsMs(data.updatedAt) ?? now;
    await fetch(`${apiBase}/v1/sql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        sql: 'INSERT INTO scheduled_tasks_meta (id, created_at_ms, updated_at_ms) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET updated_at_ms=excluded.updated_at_ms',
        params: [created, updated],
        mode: 'run',
      }),
    });
    for (const t of tasks) {
      const task = t as Record<string, unknown>;
      await fetch(`${apiBase}/v1/sql`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          sql: `INSERT INTO scheduled_tasks (
            id, label, enabled, task_key, timezone, frequency, time_of_day, every_hours, payload_json,
            last_run_at_ms, last_run_ok, last_run_summary, last_error
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label`,
          params: [
            task.id,
            task.label,
            task.enabled === false ? 0 : 1,
            task.taskKey,
            task.timezone,
            task.frequency,
            task.timeOfDay ?? null,
            task.everyHours ?? null,
            JSON.stringify(task.payload ?? {}),
            tsMs(task.lastRunAt),
            typeof task.lastRunOk === 'boolean' ? (task.lastRunOk ? 1 : 0) : null,
            task.lastRunSummary ?? null,
            task.lastError ?? null,
          ],
          mode: 'run',
        }),
      });
    }
  });

  const steamMigrations: Array<{ col: string; table: string; map: (id: string, d: Record<string, unknown>) => { sql: string; params: unknown[] } }> = [
    {
      col: CONFIG_COLLECTIONS.steamProfile,
      table: 'steam_profiles',
      map: (id, d) => ({
        sql: `INSERT INTO steam_profiles (
          steam_id, persona_name, real_name, avatar, avatar_full, profile_url, country_code,
          country_hydration_checked_at_ms, force_country_refresh_once, time_created, last_fetched_at_ms, linked_user_id
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(steam_id) DO UPDATE SET persona_name=excluded.persona_name`,
        params: [
          id,
          d.personaName,
          d.realName ?? null,
          d.avatar ?? null,
          d.avatarFull ?? null,
          d.profileUrl ?? null,
          d.countryCode ?? null,
          tsMs(d.countryHydrationCheckedAt),
          d.forceCountryRefreshOnce ? 1 : 0,
          d.timeCreated ?? null,
          tsMs(d.lastFetchedAt),
          d.linkedUserId ?? null,
        ],
      }),
    },
    {
      col: CONFIG_COLLECTIONS.steamFriends,
      table: 'steam_friends_cache',
      map: (id, d) => ({
        sql: `INSERT INTO steam_friends_cache (owner_steam_id, friends_json, last_fetched_at_ms) VALUES (?,?,?)
          ON CONFLICT(owner_steam_id) DO UPDATE SET friends_json=excluded.friends_json`,
        params: [id, JSON.stringify(d.friends ?? []), tsMs(d.lastFetchedAt) ?? now],
      }),
    },
    {
      col: CONFIG_COLLECTIONS.steamOwned,
      table: 'steam_owned_games_cache',
      map: (id, d) => ({
        sql: `INSERT INTO steam_owned_games_cache (owner_steam_id, games_json, game_count, last_fetched_at_ms) VALUES (?,?,?,?)
          ON CONFLICT(owner_steam_id) DO UPDATE SET games_json=excluded.games_json`,
        params: [
          id,
          JSON.stringify(d.games ?? []),
          d.gameCount ?? 0,
          tsMs(d.lastFetchedAt) ?? now,
        ],
      }),
    },
    {
      col: CONFIG_COLLECTIONS.steamRecent,
      table: 'steam_recent_games_cache',
      map: (id, d) => ({
        sql: `INSERT INTO steam_recent_games_cache (owner_steam_id, games_json, total_count, last_fetched_at_ms) VALUES (?,?,?,?)
          ON CONFLICT(owner_steam_id) DO UPDATE SET games_json=excluded.games_json`,
        params: [
          id,
          JSON.stringify(d.games ?? []),
          d.totalCount ?? 0,
          tsMs(d.lastFetchedAt) ?? now,
        ],
      }),
    },
  ];

  for (const s of steamMigrations) {
    await migrateDocCollection(db, apiBase, headers, s.col, s.table, s.map);
  }

  // eslint-disable-next-line no-console
  console.log('[migrate-config] done (game_* tables created empty by schema.sql only)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
