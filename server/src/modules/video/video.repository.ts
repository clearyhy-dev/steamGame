import admin from 'firebase-admin';
import type { Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getFirestore } from '../../config/firebase';
import type { VideoDoc, VideoStatus, Visibility } from './video.types';
import { ApiError } from '../../utils/apiError';

const COLLECTION = 'videos';

export class VideoRepository {
  private db = getFirestore();

  async create(data: Omit<VideoDoc, 'videoId' | 'createdAt' | 'updatedAt'>): Promise<string> {
    try {
      const ref = this.db.collection(COLLECTION).doc();
      const now = admin.firestore.Timestamp.now();
      const videoId = ref.id;
      await ref.set({
        ...data,
        videoId,
        createdAt: now,
        updatedAt: now,
      });
      return videoId;
    } catch (e) {
      throw new ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to create video', e);
    }
  }

  async findById(videoId: string): Promise<VideoDoc | null> {
    const snap = await this.db.collection(COLLECTION).doc(videoId).get();
    if (!snap.exists) return null;
    return snap.data() as VideoDoc;
  }

  async update(videoId: string, patch: Partial<VideoDoc> & Record<string, unknown>): Promise<void> {
    try {
      await this.db
        .collection(COLLECTION)
        .doc(videoId)
        .set({ ...patch, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
    } catch (e) {
      throw new ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to update video', e);
    }
  }

  async list(params: {
    status?: VideoStatus;
    visibility?: Visibility;
    gameId?: string;
    limit?: number;
  }): Promise<VideoDoc[]> {
    let q: Query = this.db.collection(COLLECTION).orderBy('updatedAt', 'desc');
    q = q.limit(Math.min(params.limit ?? 500, 1000));
    const snap = await q.get();
    let rows = snap.docs.map((d: QueryDocumentSnapshot) => d.data() as VideoDoc);
    if (params.status) rows = rows.filter((r: VideoDoc) => r.status === params.status);
    if (params.visibility) rows = rows.filter((r: VideoDoc) => r.visibility === params.visibility);
    if (params.gameId) rows = rows.filter((r: VideoDoc) => r.gameId === params.gameId);
    return rows;
  }

  async listPublicReady(limit = 100): Promise<VideoDoc[]> {
    const rows = await this.list({ limit: 500 });
    return rows.filter((v) => v.visibility === 'public' && v.status === 'ready').slice(0, limit);
  }
}
