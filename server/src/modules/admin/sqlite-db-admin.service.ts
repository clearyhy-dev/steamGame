import type { Env } from '../../config/env';
import { sqlAll, sqlGet, sqlRun, type SqlRow } from '../../storage/sqlite/sql-client';
import { logger } from '../../utils/logger';

const TABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const MAX_LIMIT = 100;
const MAX_OFFSET = 100_000;

export type SqliteColumnMeta = {
  name: string;
  type: string;
  notnull: boolean;
  dfltValue: string | null;
  pk: number;
};

export type SqliteTableMeta = {
  name: string;
  columnCount: number;
  primaryKeyColumns: string[];
  hasDataJson: boolean;
  filterableColumns: string[];
};

const ID_LIKE_NAMES = new Set([
  'id',
  'appid',
  'doc_id',
  'key',
  'collection',
  'country_code',
  'steam_id',
  'game_id',
]);

function isIdLikeColumn(name: string, pk: number): boolean {
  if (pk > 0) return true;
  const lower = name.toLowerCase();
  if (ID_LIKE_NAMES.has(lower)) return true;
  return lower.endsWith('_id');
}

function assertTableName(table: string): void {
  if (!TABLE_NAME_RE.test(table)) {
    throw new Error('invalid table name');
  }
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export class SqliteDbAdminService {
  constructor(private env: Env) {}

  assertSqliteMode(): void {
    if (this.env.dataStore !== 'vultr_sqlite') {
      throw new Error('SQLite 管理仅在使用 DATA_STORE=vultr_sqlite 时可用');
    }
  }

  async getInfo(): Promise<{
    dataStore: string;
    sqliteApiUrl: string;
    tableCount: number;
    gameCatalogCount: number | null;
  }> {
    this.assertSqliteMode();
    const tables = await this.listTableNames();
    let gameCatalogCount: number | null = null;
    if (tables.includes('game_catalog')) {
      const row = await sqlGet<{ n: number }>('SELECT COUNT(*) AS n FROM game_catalog', []);
      gameCatalogCount = Number(row?.n ?? 0);
    }
    const url = (this.env.sqliteApiUrl ?? '').replace(/\/+$/, '');
    const masked = url.replace(/^(https?:\/\/)([^/@]+@)?([^/]+)/i, '$1***@$3');
    return {
      dataStore: this.env.dataStore,
      sqliteApiUrl: masked || '(未配置 SQLITE_API_URL)',
      tableCount: tables.length,
      gameCatalogCount,
    };
  }

  async listTableNames(): Promise<string[]> {
    const rows = await sqlAll<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      [],
    );
    return rows.map((r) => String(r.name));
  }

  async assertTableExists(table: string): Promise<void> {
    assertTableName(table);
    const names = await this.listTableNames();
    if (!names.includes(table)) {
      throw new Error(`表不存在: ${table}`);
    }
  }

  async getTableSchema(table: string): Promise<SqliteColumnMeta[]> {
    await this.assertTableExists(table);
    const rows = await sqlAll<SqlRow>(`SELECT * FROM pragma_table_info(?)`, [table]);
    return rows.map((r) => ({
      name: String(r.name),
      type: String(r.type ?? ''),
      notnull: Number(r.notnull) === 1,
      dfltValue: r.dflt_value != null ? String(r.dflt_value) : null,
      pk: Number(r.pk ?? 0),
    }));
  }

  async listTablesMeta(): Promise<SqliteTableMeta[]> {
    const names = await this.listTableNames();
    const out: SqliteTableMeta[] = [];
    for (const name of names) {
      const cols = await this.getTableSchema(name);
      const pkCols = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
      const filterable = cols.filter((c) => isIdLikeColumn(c.name, c.pk)).map((c) => c.name);
      out.push({
        name,
        columnCount: cols.length,
        primaryKeyColumns: pkCols,
        hasDataJson: cols.some((c) => c.name === 'data_json'),
        filterableColumns: filterable,
      });
    }
    return out;
  }

  async queryRows(
    table: string,
    opts: { limit?: number; offset?: number; filters?: Record<string, string> },
  ): Promise<{ rows: SqlRow[]; limit: number; offset: number; total?: number }> {
    await this.assertTableExists(table);
    const cols = await this.getTableSchema(table);
    const colNames = new Set(cols.map((c) => c.name));
    const filterable = new Set(cols.filter((c) => isIdLikeColumn(c.name, c.pk)).map((c) => c.name));

    const filters: Record<string, string> = {};
    for (const [k, v] of Object.entries(opts.filters ?? {})) {
      const val = String(v ?? '').trim();
      if (!val) continue;
      if (!filterable.has(k) || !colNames.has(k)) {
        throw new Error(`不允许的筛选字段: ${k}`);
      }
      filters[k] = val;
    }

    const limit = Math.max(1, Math.min(Number(opts.limit) || 50, MAX_LIMIT));
    const offset = Math.max(0, Math.min(Number(opts.offset) || 0, MAX_OFFSET));

    const whereParts: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(filters)) {
      whereParts.push(`${quoteIdent(k)} = ?`);
      params.push(v);
    }
    const where = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';

    const pkCols = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
    const orderBy =
      pkCols.length > 0
        ? pkCols.map((c) => `${quoteIdent(c.name)} ASC`).join(', ')
        : 'rowid ASC';

    const sql = `SELECT * FROM ${quoteIdent(table)} ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    params.push(limit, offset);
    const rows = await sqlAll<SqlRow>(sql, params);

    let total: number | undefined;
    if (Object.keys(filters).length > 0) {
      const countSql = `SELECT COUNT(*) AS n FROM ${quoteIdent(table)} ${where}`;
      const countParams = params.slice(0, -2);
      const countRow = await sqlGet<{ n: number }>(countSql, countParams);
      total = Number(countRow?.n ?? 0);
    }

    return { rows, limit, offset, total };
  }

  async updateRow(
    table: string,
    primaryKey: Record<string, unknown>,
    patch: Record<string, unknown>,
    operator?: string,
  ): Promise<{ changes: number }> {
    await this.assertTableExists(table);
    const cols = await this.getTableSchema(table);
    const colMap = new Map(cols.map((c) => [c.name, c]));
    const pkCols = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);

    if (pkCols.length === 0) {
      throw new Error('该表无主键，不支持行更新');
    }

    for (const pk of pkCols) {
      if (primaryKey[pk.name] === undefined || primaryKey[pk.name] === null || primaryKey[pk.name] === '') {
        throw new Error(`缺少主键字段: ${pk.name}`);
      }
    }

    const setParts: string[] = [];
    const params: unknown[] = [];

    for (const [key, raw] of Object.entries(patch)) {
      if (!colMap.has(key)) {
        throw new Error(`未知列: ${key}`);
      }
      if (pkCols.some((p) => p.name === key)) {
        throw new Error(`不可修改主键列: ${key}`);
      }
      let value: unknown = raw;
      if (key === 'data_json' || key.endsWith('_json')) {
        if (typeof raw === 'string') {
          try {
            JSON.parse(raw);
          } catch {
            throw new Error(`${key} 必须是合法 JSON`);
          }
          value = raw;
        } else if (raw !== null && typeof raw === 'object') {
          value = JSON.stringify(raw);
        }
      }
      setParts.push(`${quoteIdent(key)} = ?`);
      params.push(value);
    }

    if (setParts.length === 0) {
      throw new Error('patch 为空');
    }

    const whereParts = pkCols.map((p) => `${quoteIdent(p.name)} = ?`);
    for (const p of pkCols) {
      params.push(primaryKey[p.name]);
    }

    const sql = `UPDATE ${quoteIdent(table)} SET ${setParts.join(', ')} WHERE ${whereParts.join(' AND ')}`;
    const { changes } = await sqlRun(sql, params);
    logger.info(
      `[sqlite-db-admin] update table=${table} pk=${JSON.stringify(primaryKey)} cols=${Object.keys(patch).join(',')} by=${operator ?? 'admin'} changes=${changes}`,
    );
    return { changes };
  }
}
