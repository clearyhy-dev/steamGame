import type { Request, Response } from 'express';
import { RequestLogRepository } from '../observability/request-log.repository';
import type { ApiRequestLogDoc } from '../observability/request-log.types';

function toIso(ts: unknown): string | null {
  try {
    if (!ts) return null;
    if (ts instanceof Date) return ts.toISOString();
    if (typeof (ts as any)?.toDate === 'function') return (ts as any).toDate().toISOString();
    const d = new Date(ts as any);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

function serializeRow(x: ApiRequestLogDoc) {
  return {
    ...x,
    createdAt: toIso(x.createdAt),
  };
}

export class AdminRequestLogsController {
  private repo = new RequestLogRepository();

  list = async (req: Request, res: Response) => {
    const userId = String(req.query.userId ?? '').trim() || undefined;
    const pathPrefix = String(req.query.pathPrefix ?? '').trim() || undefined;
    const method = String(req.query.method ?? '').trim().toUpperCase() || undefined;
    const statusCodeRaw = String(req.query.statusCode ?? '').trim();
    const fromRaw = String(req.query.fromMs ?? '').trim();
    const toRaw = String(req.query.toMs ?? '').trim();
    const limitRaw = String(req.query.limit ?? '').trim();

    const rows = await this.repo.listLogs({
      userId,
      pathPrefix,
      method,
      statusCode: statusCodeRaw ? Number(statusCodeRaw) : undefined,
      fromMs: fromRaw ? Number(fromRaw) : undefined,
      toMs: toRaw ? Number(toRaw) : undefined,
      limit: limitRaw ? Number(limitRaw) : 100,
    });

    res.json({
      ok: true,
      data: {
        total: rows.length,
        rows: rows.map(serializeRow),
      },
    });
  };
}
