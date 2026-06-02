/**
 * 一次性：Firestore → Vultr SQLite Data API
 * 用法（需 GOOGLE_APPLICATION_CREDENTIALS + SQLITE_API_URL + SQLITE_API_SECRET）:
 *   npx ts-node scripts/migrate-firestore-to-vultr-sqlite.ts
 */
import admin from 'firebase-admin';
import { loadEnv } from '../src/config/env';
import { serializeForSqlite } from '../src/storage/vultr-db/serialize';

const COLLECTIONS = [
  'game_catalog',
  'game_reviews',
  'game_weekly_heat',
  'game_discount_offers',
  'game_deal_links',
  'region_country_configs',
  'system_config',
  'videos',
  'video_jobs',
  'video_sources',
  'users',
  'user_favorites',
  'steam_profiles',
  'steam_friends_cache',
  'steam_games_owned_cache',
  'steam_games_recent_cache',
  'api_request_logs',
];

async function main(): Promise<void> {
  const env = loadEnv();
  const base = env.sqliteApiUrl ?? process.env.SQLITE_API_URL?.trim();
  const secret = env.sqliteApiSecret ?? process.env.SQLITE_API_SECRET?.trim();
  if (!base) throw new Error('SQLITE_API_URL required');

  if (!admin.apps.length) {
    admin.initializeApp({
      projectId: env.firebaseProjectId,
      credential: admin.credential.applicationDefault(),
    });
  }
  const db = admin.firestore();

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) headers['X-Data-Api-Secret'] = secret;

  for (const collection of COLLECTIONS) {
    let total = 0;
    let lastId: string | undefined;
    while (true) {
      let q = db.collection(collection).orderBy(admin.firestore.FieldPath.documentId()).limit(400);
      if (lastId) q = q.startAfter(lastId);
      const snap = await q.get();
      if (snap.empty) break;

      const docs = snap.docs.map((d) => ({
        id: d.id,
        data: serializeForSqlite(d.data()) as Record<string, unknown>,
      }));

      const res = await fetch(`${base.replace(/\/+$/, '')}/v1/batch-set`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ collection, docs }),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`batch-set ${collection} failed: ${res.status} ${t}`);
      }

      total += docs.length;
      lastId = snap.docs[snap.docs.length - 1].id;
      // eslint-disable-next-line no-console
      console.log(`[migrate] ${collection} +${docs.length} (total ${total})`);
      if (snap.size < 400) break;
    }
    // eslint-disable-next-line no-console
    console.log(`[migrate] ${collection} done, total=${total}`);
  }

  // eslint-disable-next-line no-console
  console.log('[migrate] complete');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
