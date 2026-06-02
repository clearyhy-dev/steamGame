import express from 'express';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import {
  batchGet,
  batchSet,
  buildQuery,
  countCollection,
  deleteDoc,
  getDoc,
  putDoc,
  type QueryBody,
} from './collection-routing';

const PORT = Number(process.env.PORT ?? 8090);
const SQLITE_PATH = process.env.SQLITE_PATH?.trim() || '/data/steam.db';
const SECRET = process.env.DATA_API_SECRET?.trim() || '';

const dir = path.dirname(SQLITE_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(SQLITE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

const schemaCandidates = [
  path.join(__dirname, 'schema.sql'),
  path.join(__dirname, '..', 'src', 'schema.sql'),
  path.join(__dirname, '..', 'schema.sql'),
];
const schemaPath = schemaCandidates.find((p) => fs.existsSync(p));
if (schemaPath) {
  db.exec(fs.readFileSync(schemaPath, 'utf-8'));
  // eslint-disable-next-line no-console
  console.log(`[data-api] schema applied: ${schemaPath}`);
} else {
  // eslint-disable-next-line no-console
  console.warn('[data-api] schema.sql not found');
}

function auth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  if (!SECRET) {
    next();
    return;
  }
  const h = String(req.headers['x-data-api-secret'] ?? '').trim();
  if (h !== SECRET) {
    res.status(401).json({ ok: false, message: 'Unauthorized' });
    return;
  }
  next();
}

const app = express();
app.use(express.json({ limit: '12mb' }));

app.get('/health', (_req, res) => {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all() as Array<{ name: string }>;
  const gameCount = (db.prepare('SELECT COUNT(*) AS n FROM game_catalog').get() as { n: number }).n;
  res.json({ ok: true, sqlitePath: SQLITE_PATH, tables: tables.length, gameCatalog: gameCount });
});

app.use(auth);

app.get('/v1/doc/:collection/:docId', (req, res) => {
  const row = getDoc(db, req.params.collection, req.params.docId);
  if (!row.exists || !row.data) {
    res.status(404).json({ ok: false, exists: false });
    return;
  }
  res.json({ ok: true, exists: true, id: req.params.docId, data: row.data });
});

app.put('/v1/doc/:collection/:docId', (req, res) => {
  const incoming = req.body?.data ?? req.body;
  if (!incoming || typeof incoming !== 'object') {
    res.status(400).json({ ok: false, message: 'data object required' });
    return;
  }
  const merge = req.query.merge === '1' || req.query.merge === 'true';
  putDoc(db, req.params.collection, req.params.docId, incoming, merge);
  res.json({ ok: true, id: req.params.docId });
});

app.delete('/v1/doc/:collection/:docId', (req, res) => {
  deleteDoc(db, req.params.collection, req.params.docId);
  res.json({ ok: true });
});

app.post('/v1/query', (req, res) => {
  const body = req.body as QueryBody;
  if (!body?.collection) {
    res.status(400).json({ ok: false, message: 'collection required' });
    return;
  }
  const { sql, params } = buildQuery(db, body);
  const rows = db.prepare(sql).all(...params) as Array<{ doc_id: string; data: string }>;
  res.json({
    ok: true,
    docs: rows.map((r) => ({ id: r.doc_id, data: JSON.parse(r.data) })),
  });
});

app.post('/v1/count', (req, res) => {
  const body = req.body as QueryBody;
  if (!body?.collection) {
    res.status(400).json({ ok: false, message: 'collection required' });
    return;
  }
  const n = countCollection(db, body);
  res.json({ ok: true, count: n });
});

app.post('/v1/batch-get', (req, res) => {
  const collection = String(req.body?.collection ?? '');
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  if (!collection || ids.length === 0) {
    res.json({ ok: true, docs: [] });
    return;
  }
  const docs = batchGet(db, collection, ids.slice(0, 500));
  res.json({ ok: true, docs });
});

app.post('/v1/sql', (req, res) => {
  const sql = String(req.body?.sql ?? '').trim();
  const params = Array.isArray(req.body?.params) ? req.body.params : [];
  const mode = String(req.body?.mode ?? 'all').toLowerCase();
  if (!sql) {
    res.status(400).json({ ok: false, message: 'sql required' });
    return;
  }
  const upper = sql.trim().toUpperCase();
  if (
    upper.includes('DROP ') ||
    upper.includes('ATTACH ') ||
    upper.includes('DETACH ') ||
    upper.startsWith('PRAGMA ')
  ) {
    res.status(400).json({ ok: false, message: 'sql not allowed' });
    return;
  }
  try {
    const stmt = db.prepare(sql);
    if (mode === 'run') {
      const info = stmt.run(...params);
      res.json({
        ok: true,
        changes: info.changes,
        lastInsertRowid: Number(info.lastInsertRowid),
      });
      return;
    }
    if (mode === 'get') {
      const row = stmt.get(...params);
      res.json({ ok: true, row: row ?? null });
      return;
    }
    const rows = stmt.all(...params);
    res.json({ ok: true, rows });
  } catch (e) {
    res.status(500).json({ ok: false, message: e instanceof Error ? e.message : String(e) });
  }
});

app.post('/v1/batch-set', (req, res) => {
  const collection = String(req.body?.collection ?? '');
  const docs = Array.isArray(req.body?.docs) ? req.body.docs : [];
  if (!collection) {
    res.status(400).json({ ok: false, message: 'collection required' });
    return;
  }
  batchSet(db, collection, docs.slice(0, 500));
  res.json({ ok: true, written: Math.min(docs.length, 500) });
});

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`[data-api] listening on 0.0.0.0:${PORT} db=${SQLITE_PATH}`);
});
