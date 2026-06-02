import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import { SqliteDbAdminService } from './sqlite-db-admin.service';
import type { AdminAuthedRequest } from './adminAuth.middleware';

export class AdminSqliteDbController {
  private svc: SqliteDbAdminService;

  constructor(env: Env) {
    this.svc = new SqliteDbAdminService(env);
  }

  private handleError(res: Response, e: unknown, status = 400): void {
    const msg = e instanceof Error ? e.message : String(e);
    sendAdminFail(res, status, msg);
  }

  info = async (_req: Request, res: Response): Promise<void> => {
    try {
      const data = await this.svc.getInfo();
      sendAdminOk(res, data);
    } catch (e) {
      this.handleError(res, e);
    }
  };

  listTables = async (_req: Request, res: Response): Promise<void> => {
    try {
      const tables = await this.svc.listTablesMeta();
      sendAdminOk(res, { tables });
    } catch (e) {
      this.handleError(res, e);
    }
  };

  schema = async (req: Request, res: Response): Promise<void> => {
    try {
      const table = String(req.params.table ?? '').trim();
      const columns = await this.svc.getTableSchema(table);
      sendAdminOk(res, { table, columns });
    } catch (e) {
      this.handleError(res, e);
    }
  };

  rows = async (req: Request, res: Response): Promise<void> => {
    try {
      const table = String(req.params.table ?? '').trim();
      const q = req.query as Record<string, string | undefined>;
      const filters: Record<string, string> = {};
      for (const [k, v] of Object.entries(q)) {
        if (k === 'limit' || k === 'offset' || v === undefined || v === '') continue;
        filters[k] = String(v);
      }
      const out = await this.svc.queryRows(table, {
        limit: q.limit ? Number(q.limit) : undefined,
        offset: q.offset ? Number(q.offset) : undefined,
        filters,
      });
      sendAdminOk(res, { table, ...out });
    } catch (e) {
      this.handleError(res, e);
    }
  };

  updateRow = async (req: AdminAuthedRequest, res: Response): Promise<void> => {
    try {
      const table = String(req.params.table ?? '').trim();
      const body = req.body as { primaryKey?: Record<string, unknown>; patch?: Record<string, unknown> };
      if (!body?.primaryKey || !body?.patch) {
        sendAdminFail(res, 400, 'primaryKey 与 patch 必填');
        return;
      }
      const out = await this.svc.updateRow(table, body.primaryKey, body.patch, req.admin?.username);
      sendAdminOk(res, out);
    } catch (e) {
      this.handleError(res, e);
    }
  };
}
