import admin from 'firebase-admin';
import type { Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getFirestore } from '../../config/firebase';
import type { SourceType, VideoSourceDoc } from './video.types';
import { ApiError } from '../../utils/apiError';

const COLLECTION = 'video_sources';

function omitUndefinedRecord(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export class VideoSourceRepository {
  private db = getFirestore();

  async create(data: Omit<VideoSourceDoc, 'sourceId' | 'createdAt' | 'updatedAt'>): Promise<string> {
    try {
      const ref = this.db.collection(COLLECTION).doc();
      const now = admin.firestore.Timestamp.now();
      const sourceId = ref.id;
      const payload = omitUndefinedRecord({
        ...data,
        sourceId,
        createdAt: now,
        updatedAt: now,
      });
      await ref.set(payload);
      return sourceId;
    } catch (e) {
      throw new ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to create video source', e);
    }
  }

  async findById(sourceId: string): Promise<VideoSourceDoc | null> {
    const snap = await this.db.collection(COLLECTION).doc(sourceId).get();
    if (!snap.exists) return null;
    return snap.data() as VideoSourceDoc;
  }

  async findSteamByAppId(steamAppId: string): Promise<VideoSourceDoc | null> {
    const appid = String(steamAppId ?? '').trim();
    if (!appid) return null;
    const snap = await this.db.collection(COLLECTION).where('steamAppId', '==', appid).limit(20).get();
    const row = snap.docs.map((d: QueryDocumentSnapshot) => d.data() as VideoSourceDoc).find((x) => x.sourceType === 'steam');
    return row ?? null;
  }

  async update(sourceId: string, patch: Partial<VideoSourceDoc>): Promise<void> {
    try {
      const payload = omitUndefinedRecord({
        ...patch,
        updatedAt: admin.firestore.Timestamp.now(),
      });
      await this.db
        .collection(COLLECTION)
        .doc(sourceId)
        .set(payload, { merge: true });
    } catch (e) {
      throw new ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to update video source', e);
    }
  }

  /** Loads recent rows and filters in memory to avoid composite index requirements. */
  async list(params: { sourceType?: SourceType; gameId?: string; limit?: number }): Promise<VideoSourceDoc[]> {
    let q: Query = this.db.collection(COLLECTION).orderBy('createdAt', 'desc');

    q = q.limit(Math.min(params.limit ?? 500, 1000));

    const snap = await q.get();
    let rows = snap.docs.map((d: QueryDocumentSnapshot) => d.data() as VideoSourceDoc);

    if (params.sourceType) {
      rows = rows.filter((r: VideoSourceDoc) => r.sourceType === params.sourceType);
    }
    if (params.gameId) {
      rows = rows.filter((r: VideoSourceDoc) => r.gameId === params.gameId);
    }

    return rows;
  }
}
