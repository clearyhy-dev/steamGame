import type Database from 'better-sqlite3';

export type QueryBody = {
  collection: string;
  filters?: Array<{ field: string; op: '==' | 'in' | '!='; value: unknown }>;
  orderBy?: { field: string; direction?: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
  startAfterId?: string;
};

type CollectionKind =
  | { kind: 'game_catalog' }
  | { kind: 'game_reviews' }
  | { kind: 'game_weekly_heat' }
  | { kind: 'videos' }
  | { kind: 'video_jobs' }
  | { kind: 'video_sources' }
  | { kind: 'json_doc'; table: string }
  | { kind: 'legacy_documents' };

const JSON_DOC_COLLECTIONS = new Set([
  'user_favorites',
  'game_deal_links',
  'game_discount_offers',
  'steam_sync_jobs',
  'api_request_logs',
]);

export function resolveCollection(collection: string): CollectionKind {
  if (collection === 'game_catalog') return { kind: 'game_catalog' };
  if (collection === 'game_reviews') return { kind: 'game_reviews' };
  if (collection === 'game_weekly_heat') return { kind: 'game_weekly_heat' };
  if (collection === 'videos') return { kind: 'videos' };
  if (collection === 'video_jobs') return { kind: 'video_jobs' };
  if (collection === 'video_sources') return { kind: 'video_sources' };
  if (JSON_DOC_COLLECTIONS.has(collection)) return { kind: 'json_doc', table: collection };
  return { kind: 'legacy_documents' };
}

function tsMs(val: unknown): number | null {
  if (val == null) return null;
  if (typeof val === 'object') {
    const o = val as Record<string, unknown>;
    if (o._firestore_timestamp === true && typeof o.seconds === 'number') {
      return o.seconds * 1000;
    }
  }
  if (typeof val === 'string') {
    const t = Date.parse(val);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

function mergePayload(
  db: Database.Database,
  sql: string,
  id: string,
  incoming: Record<string, unknown>,
  merge: boolean,
): Record<string, unknown> {
  if (!merge) return incoming;
  const row = db.prepare(sql).get(id) as { data_json?: string; data?: string } | undefined;
  const raw = row?.data_json ?? row?.data;
  if (!raw) return incoming;
  return { ...JSON.parse(raw), ...incoming };
}

function syncGameCatalog(db: Database.Database, appid: string, payload: Record<string, unknown>): void {
  const now = Date.now();
  const created = tsMs(payload.createdAt) ?? now;
  const updated = tsMs(payload.updatedAt) ?? now;
  db.prepare(
    `INSERT INTO game_catalog (
      appid, name, detail_synced, data_json, current_players, discount_percent,
      last_detail_sync_at_ms, created_at_ms, updated_at_ms
    ) VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(appid) DO UPDATE SET
      name=excluded.name,
      detail_synced=excluded.detail_synced,
      data_json=excluded.data_json,
      current_players=excluded.current_players,
      discount_percent=excluded.discount_percent,
      last_detail_sync_at_ms=excluded.last_detail_sync_at_ms,
      updated_at_ms=excluded.updated_at_ms`,
  ).run(
    appid,
    String(payload.name ?? `App ${appid}`),
    payload.detailSynced === true ? 1 : 0,
    JSON.stringify(payload),
    Math.max(0, Math.trunc(Number(payload.currentPlayers ?? 0))),
    Number(payload.discountPercent ?? 0),
    tsMs(payload.lastDetailSyncAt) ?? tsMs(payload.lastMetaSyncedAt),
    created,
    updated,
  );
}

function syncVideoLike(
  db: Database.Database,
  table: 'videos' | 'video_jobs' | 'video_sources',
  id: string,
  payload: Record<string, unknown>,
): void {
  const now = Date.now();
  const created = tsMs(payload.createdAt) ?? now;
  const updated = tsMs(payload.updatedAt) ?? now;
  if (table === 'video_sources') {
    db.prepare(
      `INSERT INTO video_sources (id, steam_app_id, data_json, created_at_ms)
       VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET steam_app_id=excluded.steam_app_id, data_json=excluded.data_json`,
    ).run(id, payload.steamAppId ?? payload.gameId ?? null, JSON.stringify(payload), created);
    return;
  }
  db.prepare(
    `INSERT INTO ${table} (id, data_json, status, visibility, game_id, created_at_ms, updated_at_ms)
     VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       data_json=excluded.data_json,
       status=excluded.status,
       visibility=excluded.visibility,
       game_id=excluded.game_id,
       updated_at_ms=excluded.updated_at_ms`,
  ).run(
    id,
    JSON.stringify(payload),
    payload.status ?? null,
    payload.visibility ?? null,
    payload.gameId ?? payload.steamAppId ?? null,
    created,
    updated,
  );
}

function syncGameReviews(db: Database.Database, appid: string, payload: Record<string, unknown>): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO game_reviews (appid, data_json, updated_at_ms) VALUES (?,?,?)
     ON CONFLICT(appid) DO UPDATE SET data_json=excluded.data_json, updated_at_ms=excluded.updated_at_ms`,
  ).run(appid, JSON.stringify(payload), tsMs(payload.updatedAt) ?? now);
}

function syncGameWeeklyHeat(db: Database.Database, appid: string, payload: Record<string, unknown>): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO game_weekly_heat (appid, data_json, updated_at_ms) VALUES (?,?,?)
     ON CONFLICT(appid) DO UPDATE SET data_json=excluded.data_json, updated_at_ms=excluded.updated_at_ms`,
  ).run(appid, JSON.stringify(payload), tsMs(payload.updatedAt) ?? now);
}

export function getDoc(
  db: Database.Database,
  collection: string,
  docId: string,
): { exists: boolean; data?: Record<string, unknown> } {
  const kind = resolveCollection(collection);
  if (kind.kind === 'game_catalog') {
    const row = db.prepare('SELECT data_json FROM game_catalog WHERE appid = ?').get(docId) as
      | { data_json: string }
      | undefined;
    return row ? { exists: true, data: JSON.parse(row.data_json) } : { exists: false };
  }
  if (kind.kind === 'game_reviews') {
    const row = db.prepare('SELECT data_json FROM game_reviews WHERE appid = ?').get(docId) as
      | { data_json: string }
      | undefined;
    return row ? { exists: true, data: JSON.parse(row.data_json) } : { exists: false };
  }
  if (kind.kind === 'game_weekly_heat') {
    const row = db.prepare('SELECT data_json FROM game_weekly_heat WHERE appid = ?').get(docId) as
      | { data_json: string }
      | undefined;
    return row ? { exists: true, data: JSON.parse(row.data_json) } : { exists: false };
  }
  if (kind.kind === 'videos' || kind.kind === 'video_jobs' || kind.kind === 'video_sources') {
    const row = db.prepare(`SELECT data_json FROM ${kind.kind} WHERE id = ?`).get(docId) as
      | { data_json: string }
      | undefined;
    return row ? { exists: true, data: JSON.parse(row.data_json) } : { exists: false };
  }
  if (kind.kind === 'json_doc') {
    const row = db.prepare(`SELECT data_json FROM ${kind.table} WHERE doc_id = ?`).get(docId) as
      | { data_json: string }
      | undefined;
    return row ? { exists: true, data: JSON.parse(row.data_json) } : { exists: false };
  }
  const row = db
    .prepare('SELECT data FROM documents WHERE collection = ? AND doc_id = ?')
    .get(collection, docId) as { data: string } | undefined;
  return row ? { exists: true, data: JSON.parse(row.data) } : { exists: false };
}

export function putDoc(
  db: Database.Database,
  collection: string,
  docId: string,
  incoming: Record<string, unknown>,
  merge: boolean,
): void {
  const kind = resolveCollection(collection);
  const now = Date.now();

  if (kind.kind === 'game_catalog') {
    const payload = mergePayload(db, 'SELECT data_json FROM game_catalog WHERE appid = ?', docId, incoming, merge);
    syncGameCatalog(db, docId, payload);
    return;
  }
  if (kind.kind === 'game_reviews') {
    const payload = mergePayload(db, 'SELECT data_json FROM game_reviews WHERE appid = ?', docId, incoming, merge);
    syncGameReviews(db, docId, payload);
    return;
  }
  if (kind.kind === 'game_weekly_heat') {
    const payload = mergePayload(db, 'SELECT data_json FROM game_weekly_heat WHERE appid = ?', docId, incoming, merge);
    syncGameWeeklyHeat(db, docId, payload);
    return;
  }
  if (kind.kind === 'videos' || kind.kind === 'video_jobs' || kind.kind === 'video_sources') {
    const payload = mergePayload(db, `SELECT data_json FROM ${kind.kind} WHERE id = ?`, docId, incoming, merge);
    syncVideoLike(db, kind.kind, docId, payload);
    return;
  }
  if (kind.kind === 'json_doc') {
    const payload = mergePayload(db, `SELECT data_json FROM ${kind.table} WHERE doc_id = ?`, docId, incoming, merge);
    db.prepare(
      `INSERT INTO ${kind.table} (doc_id, data_json, updated_at_ms) VALUES (?,?,?)
       ON CONFLICT(doc_id) DO UPDATE SET data_json=excluded.data_json, updated_at_ms=excluded.updated_at_ms`,
    ).run(docId, JSON.stringify(payload), now);
    return;
  }
  let payload = incoming;
  if (merge) {
    const row = db
      .prepare('SELECT data FROM documents WHERE collection = ? AND doc_id = ?')
      .get(collection, docId) as { data: string } | undefined;
    if (row) payload = { ...JSON.parse(row.data), ...incoming };
  }
  db.prepare(
    `INSERT INTO documents (collection, doc_id, data, updated_at_ms) VALUES (?, ?, ?, ?)
     ON CONFLICT(collection, doc_id) DO UPDATE SET data = excluded.data, updated_at_ms = excluded.updated_at_ms`,
  ).run(collection, docId, JSON.stringify(payload), now);
}

export function deleteDoc(db: Database.Database, collection: string, docId: string): void {
  const kind = resolveCollection(collection);
  if (kind.kind === 'game_catalog') {
    db.prepare('DELETE FROM game_catalog WHERE appid = ?').run(docId);
    return;
  }
  if (kind.kind === 'game_reviews') {
    db.prepare('DELETE FROM game_reviews WHERE appid = ?').run(docId);
    return;
  }
  if (kind.kind === 'game_weekly_heat') {
    db.prepare('DELETE FROM game_weekly_heat WHERE appid = ?').run(docId);
    return;
  }
  if (kind.kind === 'videos' || kind.kind === 'video_jobs' || kind.kind === 'video_sources') {
    db.prepare(`DELETE FROM ${kind.kind} WHERE id = ?`).run(docId);
    return;
  }
  if (kind.kind === 'json_doc') {
    db.prepare(`DELETE FROM ${kind.table} WHERE doc_id = ?`).run(docId);
    return;
  }
  db.prepare('DELETE FROM documents WHERE collection = ? AND doc_id = ?').run(collection, docId);
}

function idColumn(kind: CollectionKind): string {
  if (kind.kind === 'game_catalog' || kind.kind === 'game_reviews' || kind.kind === 'game_weekly_heat') {
    return kind.kind === 'game_catalog' ? 'appid' : 'appid';
  }
  if (kind.kind === 'videos' || kind.kind === 'video_jobs' || kind.kind === 'video_sources') return 'id';
  if (kind.kind === 'json_doc') return 'doc_id';
  return 'doc_id';
}

function gameCatalogOrderColumn(field: string): string | null {
  const map: Record<string, string> = {
    appid: 'appid',
    __name__: 'appid',
    __id__: 'appid',
    currentPlayers: 'current_players',
    discountPercent: 'discount_percent',
    updatedAt: 'updated_at_ms',
    createdAt: 'created_at_ms',
    name: 'name',
    detailSynced: 'detail_synced',
  };
  return map[field] ?? null;
}

function jsonExtractOnData(field: string): string {
  if (field === '__name__' || field === '__id__') return 'doc_id';
  const parts = field.split('.');
  if (parts.length === 1) return `json_extract(data_json, '$.${parts[0]}')`;
  return `json_extract(data_json, '$.${parts.join('.')}')`;
}

export function buildQuery(db: Database.Database, body: QueryBody): { sql: string; params: unknown[] } {
  const kind = resolveCollection(body.collection);
  const params: unknown[] = [];

  if (kind.kind === 'game_catalog') {
    let sql = 'SELECT appid AS doc_id, data_json AS data FROM game_catalog WHERE 1=1';
    for (const f of body.filters ?? []) {
      const col = gameCatalogOrderColumn(f.field) ?? jsonExtractOnData(f.field);
      if (f.op === '==') {
        sql += ` AND ${col} = ?`;
        params.push(f.value);
      } else if (f.op === '!=') {
        sql += ` AND (${col} IS NULL OR ${col} != ?)`;
        params.push(f.value);
      } else if (f.op === 'in' && Array.isArray(f.value)) {
        const ids = f.value.slice(0, 30);
        if (ids.length === 0) sql += ' AND 1=0';
        else {
          sql += ` AND ${col} IN (${ids.map(() => '?').join(',')})`;
          params.push(...ids);
        }
      }
    }
    const obField = body.orderBy?.field ?? 'appid';
    const obCol = gameCatalogOrderColumn(obField) ?? 'appid';
    const obDir = body.orderBy?.direction === 'desc' ? 'DESC' : 'ASC';
    if (body.startAfterId) {
      const sub = `(SELECT ${obCol} FROM game_catalog WHERE appid = ?)`;
      params.push(body.startAfterId);
      if (obDir === 'ASC') {
        sql += ` AND (${obCol} > ${sub} OR (${obCol} = ${sub} AND appid > ?))`;
      } else {
        sql += ` AND (${obCol} < ${sub} OR (${obCol} = ${sub} AND appid < ?))`;
      }
      params.push(body.startAfterId, body.startAfterId);
    }
    sql += ` ORDER BY ${obCol} ${obDir}, appid ${obDir}`;
    const lim = Math.min(Math.max(body.limit ?? 500, 1), 2000);
    sql += ' LIMIT ?';
    params.push(lim);
    if (body.offset && body.offset > 0) {
      sql += ' OFFSET ?';
      params.push(body.offset);
    }
    return { sql, params };
  }

  let table: string;
  let dataCol = 'data_json';
  if (kind.kind === 'json_doc') {
    table = kind.table;
  } else if (kind.kind === 'game_reviews' || kind.kind === 'game_weekly_heat') {
    table = kind.kind;
  } else if (kind.kind === 'videos' || kind.kind === 'video_jobs' || kind.kind === 'video_sources') {
    table = kind.kind;
  } else {
    let sql = 'SELECT doc_id, data FROM documents WHERE collection = ?';
    params.push(body.collection);
    const jsonExtract = (field: string): string => {
      if (field === '__name__' || field === '__id__') return 'doc_id';
      const parts = field.split('.');
      if (parts.length === 1) return `json_extract(data, '$.${parts[0]}')`;
      return `json_extract(data, '$.${parts.join('.')}')`;
    };
    for (const f of body.filters ?? []) {
      const col = jsonExtract(f.field);
      if (f.op === '==') {
        sql += ` AND ${col} = ?`;
        params.push(f.value);
      } else if (f.op === '!=') {
        sql += ` AND (${col} IS NULL OR ${col} != ?)`;
        params.push(f.value);
      } else if (f.op === 'in' && Array.isArray(f.value)) {
        const ids = f.value.slice(0, 30);
        if (ids.length === 0) sql += ' AND 1=0';
        else {
          sql += ` AND ${col} IN (${ids.map(() => '?').join(',')})`;
          params.push(...ids);
        }
      }
    }
    const obField = body.orderBy?.field ? jsonExtract(body.orderBy.field) : 'doc_id';
    const obDir = body.orderBy?.direction === 'desc' ? 'DESC' : 'ASC';
    if (body.startAfterId) {
      params.push(body.collection, body.startAfterId, body.collection, body.startAfterId, body.startAfterId);
      if (obDir === 'ASC') {
        sql += ` AND (${obField} > (SELECT ${obField} FROM documents WHERE collection = ? AND doc_id = ?) OR (${obField} = (SELECT ${obField} FROM documents WHERE collection = ? AND doc_id = ?) AND doc_id > ?))`;
      } else {
        sql += ` AND (${obField} < (SELECT ${obField} FROM documents WHERE collection = ? AND doc_id = ?) OR (${obField} = (SELECT ${obField} FROM documents WHERE collection = ? AND doc_id = ?) AND doc_id < ?))`;
      }
    }
    sql += ` ORDER BY ${obField} ${obDir}, doc_id ${obDir}`;
    const lim = Math.min(Math.max(body.limit ?? 500, 1), 2000);
    sql += ' LIMIT ?';
    params.push(lim);
    if (body.offset && body.offset > 0) {
      sql += ' OFFSET ?';
      params.push(body.offset);
    }
    return { sql, params };
  }

  const idCol = idColumn(kind);
  let sql = `SELECT ${idCol} AS doc_id, ${dataCol} AS data FROM ${table} WHERE 1=1`;
  const jsonExtract = jsonExtractOnData;
  for (const f of body.filters ?? []) {
    const col =
      f.field === 'appid' && (kind.kind === 'game_reviews' || kind.kind === 'game_weekly_heat')
        ? 'appid'
        : jsonExtract(f.field);
    if (f.op === '==') {
      sql += ` AND ${col} = ?`;
      params.push(f.value);
    } else if (f.op === '!=') {
      sql += ` AND (${col} IS NULL OR ${col} != ?)`;
      params.push(f.value);
    } else if (f.op === 'in' && Array.isArray(f.value)) {
      const ids = f.value.slice(0, 30);
      if (ids.length === 0) sql += ' AND 1=0';
      else {
        sql += ` AND ${col} IN (${ids.map(() => '?').join(',')})`;
        params.push(...ids);
      }
    }
  }
  const obField = body.orderBy?.field ? jsonExtract(body.orderBy.field) : idCol;
  const obDir = body.orderBy?.direction === 'desc' ? 'DESC' : 'ASC';
  if (body.startAfterId) {
    params.push(body.startAfterId);
    if (obDir === 'ASC') {
      sql += ` AND (${obField} > (SELECT ${obField} FROM ${table} WHERE ${idCol} = ?) OR (${obField} = (SELECT ${obField} FROM ${table} WHERE ${idCol} = ?) AND ${idCol} > ?))`;
    } else {
      sql += ` AND (${obField} < (SELECT ${obField} FROM ${table} WHERE ${idCol} = ?) OR (${obField} = (SELECT ${obField} FROM ${table} WHERE ${idCol} = ?) AND ${idCol} < ?))`;
    }
    params.push(body.startAfterId, body.startAfterId);
  }
  sql += ` ORDER BY ${obField} ${obDir}, ${idCol} ${obDir}`;
  const lim = Math.min(Math.max(body.limit ?? 500, 1), 2000);
  sql += ' LIMIT ?';
  params.push(lim);
  if (body.offset && body.offset > 0) {
    sql += ' OFFSET ?';
    params.push(body.offset);
  }
  return { sql, params };
}

export function batchGet(
  db: Database.Database,
  collection: string,
  ids: string[],
): Array<{ id: string; data: Record<string, unknown> }> {
  const out: Array<{ id: string; data: Record<string, unknown> }> = [];
  for (const id of ids) {
    const row = getDoc(db, collection, id);
    if (row.exists && row.data) out.push({ id, data: row.data });
  }
  return out;
}

/** 全表计数（不受 query LIMIT 影响） */
export function countCollection(db: Database.Database, body: QueryBody): number {
  const kind = resolveCollection(body.collection);
  const hasFilters = (body.filters?.length ?? 0) > 0;
  if (!hasFilters) {
    if (kind.kind === 'game_catalog') {
      return (db.prepare('SELECT COUNT(*) AS n FROM game_catalog').get() as { n: number }).n;
    }
    if (kind.kind === 'game_reviews' || kind.kind === 'game_weekly_heat') {
      return (db.prepare(`SELECT COUNT(*) AS n FROM ${kind.kind}`).get() as { n: number }).n;
    }
    if (kind.kind === 'videos' || kind.kind === 'video_jobs' || kind.kind === 'video_sources') {
      return (db.prepare(`SELECT COUNT(*) AS n FROM ${kind.kind}`).get() as { n: number }).n;
    }
    if (kind.kind === 'json_doc') {
      return (db.prepare(`SELECT COUNT(*) AS n FROM ${kind.table}`).get() as { n: number }).n;
    }
    return (
      db.prepare('SELECT COUNT(*) AS n FROM documents WHERE collection = ?').get(body.collection) as { n: number }
    ).n;
  }
  const q = { ...body, limit: 999999, offset: 0 };
  const { sql, params } = buildQuery(db, q);
  const countSql = `SELECT COUNT(*) AS n FROM (${sql})`;
  return (db.prepare(countSql).get(...params) as { n: number }).n;
}

export function batchSet(
  db: Database.Database,
  collection: string,
  docs: Array<{ id: string; data: Record<string, unknown> }>,
): void {
  const tx = db.transaction((items: Array<{ id: string; data: Record<string, unknown> }>) => {
    for (const d of items) putDoc(db, collection, d.id, d.data, false);
  });
  tx(docs);
}
