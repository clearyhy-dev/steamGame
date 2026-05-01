import admin from 'firebase-admin';
import type { Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getFirestore } from '../../config/firebase';
import type { JobStatus, JobType, VideoJobDoc } from './video.types';
import { ApiError } from '../../utils/apiError';

const COLLECTION = 'video_jobs';

export class VideoJobRepository {
  private db = getFirestore();

  async create(data: Omit<VideoJobDoc, 'jobId' | 'createdAt'>): Promise<string> {
    try {
      const ref = this.db.collection(COLLECTION).doc();
      const now = admin.firestore.Timestamp.now();
      const jobId = ref.id;
      await ref.set({
        ...data,
        jobId,
        createdAt: now,
      });
      return jobId;
    } catch (e) {
      throw new ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to create video job', e);
    }
  }

  async findById(jobId: string): Promise<VideoJobDoc | null> {
    const snap = await this.db.collection(COLLECTION).doc(jobId).get();
    if (!snap.exists) return null;
    return snap.data() as VideoJobDoc;
  }

  async update(jobId: string, patch: Partial<VideoJobDoc> & Record<string, unknown>): Promise<void> {
    try {
      await this.db.collection(COLLECTION).doc(jobId).set(patch, { merge: true });
    } catch (e) {
      throw new ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to update video job', e);
    }
  }

  async list(params: { status?: JobStatus; jobType?: JobType; limit?: number }): Promise<VideoJobDoc[]> {
    let q: Query = this.db.collection(COLLECTION).orderBy('createdAt', 'desc');
    q = q.limit(Math.min(params.limit ?? 500, 1000));
    const snap = await q.get();
    let rows = snap.docs.map((d: QueryDocumentSnapshot) => d.data() as VideoJobDoc);
    if (params.status) rows = rows.filter((r: VideoJobDoc) => r.status === params.status);
    if (params.jobType) rows = rows.filter((r: VideoJobDoc) => r.jobType === params.jobType);
    return rows;
  }

  /** Oldest pending job first */
  async findPendingJobs(limit = 20): Promise<VideoJobDoc[]> {
    const snap = await this.db
      .collection(COLLECTION)
      .where('status', '==', 'pending')
      .limit(limit)
      .get();
    const rows = snap.docs.map((d: QueryDocumentSnapshot) => d.data() as VideoJobDoc);
    rows.sort((a, b) => {
      const ta = a.createdAt?.toMillis?.() ?? 0;
      const tb = b.createdAt?.toMillis?.() ?? 0;
      return ta - tb;
    });
    return rows;
  }
}
