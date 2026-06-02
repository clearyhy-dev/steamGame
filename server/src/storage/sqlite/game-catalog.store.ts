import admin from 'firebase-admin';

import type { GameCatalogDoc } from '../../modules/game/game-catalog.repository';

import { sqlAll, sqlGet, sqlRun } from './sql-client';

import { msToTimestamp } from './timestamp';



type CatalogRow = {

  appid: string;

  name: string;

  detail_synced: number;

  data_json: string;

  current_players: number;

  discount_percent: number;

  last_detail_sync_at_ms: number | null;

  created_at_ms: number;

  updated_at_ms: number;

};



function rowToDoc(row: CatalogRow): GameCatalogDoc {

  const data = JSON.parse(row.data_json) as Record<string, unknown>;

  const createdAt = msToTimestamp(row.created_at_ms) ?? admin.firestore.Timestamp.now();

  const updatedAt = msToTimestamp(row.updated_at_ms) ?? createdAt;

  const lastDetailSyncAt =

    msToTimestamp(row.last_detail_sync_at_ms) ??

    (data.lastDetailSyncAt as admin.firestore.Timestamp | undefined);

  return {

    ...(data as GameCatalogDoc),

    appid: row.appid,

    name: String(data.name ?? row.name ?? `App ${row.appid}`),

    detailSynced: row.detail_synced === 1 || data.detailSynced === true,

    headerImage: data.headerImage as string | undefined,

    screenshots: (data.screenshots as string[]) ?? [],

    trailerUrls: (data.trailerUrls as string[]) ?? [],

    trailerThumbnailUrls: (data.trailerThumbnailUrls as string[]) ?? [],

    currentPlayers: row.current_players,

    discountPercent: row.discount_percent,

    lastDetailSyncAt,

    createdAt,

    updatedAt,

  };

}



const UNSYNCED_WHERE = `

  (detail_synced = 0 OR detail_synced IS NULL)

  AND (last_detail_sync_at_ms IS NULL OR last_detail_sync_at_ms = 0)

  AND (json_extract(data_json, '$.detailUnavailable') IS NULL OR json_extract(data_json, '$.detailUnavailable') = 0)

`;



export async function sqliteCountCatalogForAdmin(params: {
  minDiscountPercent?: number;
  hasDetailSynced?: boolean;
}): Promise<number> {

  if (typeof params.hasDetailSynced === 'boolean') {

    if (params.hasDetailSynced) {

      const row = await sqlGet<{ n: number }>(

        `SELECT COUNT(*) AS n FROM game_catalog WHERE detail_synced = 1 OR last_detail_sync_at_ms > 0`,

      );

      return Number(row?.n ?? 0);

    }

    const row = await sqlGet<{ n: number }>(`SELECT COUNT(*) AS n FROM game_catalog WHERE ${UNSYNCED_WHERE}`);

    return Number(row?.n ?? 0);

  }

  if (

    typeof params.minDiscountPercent === 'number' &&

    Number.isFinite(params.minDiscountPercent) &&

    params.minDiscountPercent > 0

  ) {

    const row = await sqlGet<{ n: number }>(

      'SELECT COUNT(*) AS n FROM game_catalog WHERE discount_percent >= ?',

      [params.minDiscountPercent],

    );

    return Number(row?.n ?? 0);

  }

  const row = await sqlGet<{ n: number }>('SELECT COUNT(*) AS n FROM game_catalog');

  return Number(row?.n ?? 0);
}

/** 管理端游戏列表（SQLite 直查，避免 Firestore compat + offset 慢查询） */
export async function sqliteQueryCatalogForAdmin(params: {
  appid?: string;
  keyword?: string;
  hasDetailSynced?: boolean;
  minDiscountPercent?: number;
  page?: number;
  pageSize?: number;
  sortBy?: 'online_desc' | 'updated_desc' | 'discount_desc';
}): Promise<GameCatalogDoc[]> {
  const pageSize = Math.max(1, Math.min(params.pageSize ?? 100, 500));
  const page = Math.max(1, Math.trunc(params.page ?? 1));
  const sortBy = params.sortBy ?? 'online_desc';
  const where: string[] = [];
  const args: unknown[] = [];
  const appid = String(params.appid ?? '').trim();
  if (appid) {
    where.push('appid = ?');
    args.push(appid);
  }
  const keyword = String(params.keyword ?? '').trim().toLowerCase();
  if (keyword) {
    where.push('(LOWER(name) LIKE ? OR appid LIKE ?)');
    args.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (typeof params.minDiscountPercent === 'number' && params.minDiscountPercent > 0) {
    where.push('discount_percent >= ?');
    args.push(params.minDiscountPercent);
  }
  if (typeof params.hasDetailSynced === 'boolean') {
    where.push(params.hasDetailSynced ? '(detail_synced = 1 OR last_detail_sync_at_ms > 0)' : UNSYNCED_WHERE);
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  let orderSql = 'ORDER BY current_players DESC, CAST(appid AS INTEGER) ASC';
  if (sortBy === 'discount_desc') orderSql = 'ORDER BY discount_percent DESC, current_players DESC, CAST(appid AS INTEGER) ASC';
  else if (sortBy === 'updated_desc') orderSql = 'ORDER BY updated_at_ms DESC, CAST(appid AS INTEGER) ASC';
  const offset = (page - 1) * pageSize;
  const rows = await sqlAll<CatalogRow>(
    `SELECT appid, name, detail_synced, data_json, current_players, discount_percent,
            last_detail_sync_at_ms, created_at_ms, updated_at_ms
     FROM game_catalog ${whereSql} ${orderSql} LIMIT ? OFFSET ?`,
    [...args, pageSize, offset],
  );
  return rows.map(rowToDoc);
}

/** 按 Steam 在线人数（热度）降序 */
export async function sqliteListTopByCurrentPlayers(limit: number, offset = 0): Promise<GameCatalogDoc[]> {

  const lim = Math.max(1, Math.min(limit, 2000));

  const off = Math.max(0, Math.trunc(offset));

  const rows = await sqlAll<CatalogRow>(

    `SELECT appid, name, detail_synced, data_json, current_players, discount_percent,

            last_detail_sync_at_ms, created_at_ms, updated_at_ms

     FROM game_catalog

     ORDER BY current_players DESC, CAST(appid AS INTEGER) ASC

     LIMIT ? OFFSET ?`,

    [lim, off],

  );

  return rows.map(rowToDoc);

}



/** 热度 TopN 中尚未同步详情的 appid（排除 detailUnavailable） */

export async function sqliteListTopAppidsMissingDetail(topN: number): Promise<string[]> {

  const lim = Math.max(1, Math.min(topN, 2000));

  const rows = await sqlAll<{ appid: string }>(

    `SELECT appid FROM game_catalog

     WHERE ${UNSYNCED_WHERE}

     ORDER BY current_players DESC, CAST(appid AS INTEGER) ASC

     LIMIT ?`,

    [lim],

  );

  return rows.map((r) => String(r.appid));

}



/** 按数字 appid 升序取待同步详情（避免字符串排序卡在 1011810） */

export async function sqliteListUnsyncedByNumericAppid(

  afterAppid: string,

  limit: number,

): Promise<{ rows: GameCatalogDoc[]; exhausted: boolean }> {

  const n = Math.max(1, Math.min(limit, 500));

  const after = Math.max(0, Math.trunc(Number(afterAppid) || 0));

  const rows = await sqlAll<CatalogRow>(

    `SELECT appid, name, detail_synced, data_json, current_players, discount_percent,

            last_detail_sync_at_ms, created_at_ms, updated_at_ms

     FROM game_catalog

     WHERE ${UNSYNCED_WHERE} AND CAST(appid AS INTEGER) > ?

     ORDER BY CAST(appid AS INTEGER) ASC

     LIMIT ?`,

    [after, n],

  );

  const docs = rows.map(rowToDoc);

  return { rows: docs, exhausted: docs.length < n };

}



export async function sqliteMarkDetailUnavailable(appid: string): Promise<void> {

  const key = String(appid ?? '').trim();

  if (!key) return;

  const row = await sqlGet<CatalogRow>(

    `SELECT appid, name, detail_synced, data_json, current_players, discount_percent,

            last_detail_sync_at_ms, created_at_ms, updated_at_ms

     FROM game_catalog WHERE appid = ?`,

    [key],

  );

  const now = Date.now();

  const data = row ? (JSON.parse(row.data_json) as Record<string, unknown>) : { appid: key };

  data.detailUnavailable = true;

  data.detailUnavailableAt = new Date(now).toISOString();

  data.updatedAt = { _firestore_timestamp: true, seconds: Math.floor(now / 1000), nanoseconds: 0 };

  await sqlRun(

    `INSERT INTO game_catalog (

      appid, name, detail_synced, data_json, current_players, discount_percent,

      last_detail_sync_at_ms, created_at_ms, updated_at_ms

    ) VALUES (?,?,?,?,?,?,?,?,?)

    ON CONFLICT(appid) DO UPDATE SET

      data_json = excluded.data_json,

      updated_at_ms = excluded.updated_at_ms`,

    [

      key,

      String(data.name ?? row?.name ?? `App ${key}`),

      0,

      JSON.stringify(data),

      row?.current_players ?? 0,

      row?.discount_percent ?? 0,

      null,

      row?.created_at_ms ?? now,

      now,

    ],

  );

}


