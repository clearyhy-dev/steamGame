import admin from 'firebase-admin';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getFirestore } from '../../config/firebase';

export type SteamSyncJobDoc = {
  jobId: string;
  trigger: 'worker' | 'manual_app_list' | 'manual_detail_batch';
  status: 'success' | 'partial' | 'failed';
  appListProcessed: number;
  appListInserted: number;
  appListUpdated: number;
  detailTotal: number;
  detailSuccess: number;
  detailFailed: number;
  message?: string;
  startedAt: admin.firestore.Timestamp;
  finishedAt: admin.firestore.Timestamp;
  elapsedMs: number;
  createdAt: admin.firestore.Timestamp;
};

const COLL = 'steam_sync_jobs';

export class SteamSyncJobRepository {
  private db = getFirestore();

  async create(input: Omit<SteamSyncJobDoc, 'jobId' | 'createdAt'>): Promise<SteamSyncJobDoc> {
    const ref = this.db.collection(COLL).doc();
    const payload: SteamSyncJobDoc = {
      ...input,
      jobId: ref.id,
      createdAt: admin.firestore.Timestamp.now(),
    };
    await ref.set(payload);
    return payload;
  }

  async listRecent(limit = 30): Promise<SteamSyncJobDoc[]> {
    const n = Math.max(1, Math.min(limit, 100));
    const snap = await this.db.collection(COLL).orderBy('createdAt', 'desc').limit(n).get();
    return snap.docs.map((d: QueryDocumentSnapshot) => d.data() as SteamSyncJobDoc);
  }
}

