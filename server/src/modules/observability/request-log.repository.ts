import { getFirestore } from '../../config/firebase';
import type { ListRequestLogsInput, ApiRequestLogDoc } from './request-log.types';

const COLLECTION = 'api_request_logs';

/** Firestore 拒绝 `undefined` 字段；未登录等场景下大量可选字段为空，必须剥离后再写入。 */
function omitUndefinedRecord(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export class RequestLogRepository {
  private db = getFirestore();

  async writeLog(entry: ApiRequestLogDoc): Promise<void> {
    const payload = omitUndefinedRecord({ ...(entry as unknown as Record<string, unknown>) });
    await this.db.collection(COLLECTION).add(payload);
  }

  async listLogs(input: ListRequestLogsInput): Promise<ApiRequestLogDoc[]> {
    const limit = Math.max(1, Math.min(Number(input.limit ?? 100), 200));
    let query: FirebaseFirestore.Query = this.db.collection(COLLECTION);

    if (input.userId?.trim()) query = query.where('userId', '==', input.userId.trim());
    if (input.method?.trim()) query = query.where('method', '==', input.method.trim().toUpperCase());
    if (Number.isInteger(input.statusCode)) query = query.where('statusCode', '==', input.statusCode);
    if (Number.isFinite(input.fromMs)) query = query.where('createdAt', '>=', new Date(Number(input.fromMs)));
    if (Number.isFinite(input.toMs)) query = query.where('createdAt', '<=', new Date(Number(input.toMs)));

    const snap = await query.orderBy('createdAt', 'desc').limit(limit).get();
    let rows = snap.docs.map((d) => ({ logId: d.id, ...(d.data() as ApiRequestLogDoc) }));

    if (input.pathPrefix?.trim()) {
      const prefix = input.pathPrefix.trim();
      rows = rows.filter((x) => String(x.path ?? '').startsWith(prefix));
    }

    return rows;
  }

  async cleanupOlderThan(cutoff: Date, batchSize = 300): Promise<number> {
    const size = Math.max(50, Math.min(batchSize, 450));
    let totalDeleted = 0;

    while (true) {
      const snap = await this.db
        .collection(COLLECTION)
        .where('createdAt', '<', cutoff)
        .orderBy('createdAt', 'asc')
        .limit(size)
        .get();
      if (snap.empty) break;

      const batch = this.db.batch();
      snap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
      totalDeleted += snap.size;

      if (snap.size < size) break;
    }
    return totalDeleted;
  }
}
