import { getFirestore } from '../../config/firebase';
import type { UserDoc } from './users.types';
import { ApiError } from '../../utils/apiError';
import type { Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';

const COLLECTION = 'users';

function omitUndefinedRecord(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

export class UsersRepository {
  private db = getFirestore();

  async findById(userId: string): Promise<UserDoc | null> {
    const doc = await this.db.collection(COLLECTION).doc(userId).get();
    if (!doc.exists) return null;
    return doc.data() as UserDoc;
  }

  async findBySteamId(steamId: string): Promise<UserDoc | null> {
    // Firestore index might be required in production.
    const snap = await this.db.collection(COLLECTION).where('steamId', '==', steamId).limit(1).get();
    if (snap.empty) return null;
    return snap.docs[0].data() as UserDoc;
  }

  async createUser(user: Omit<UserDoc, 'createdAt' | 'updatedAt'> & { createdAt?: any; updatedAt?: any }): Promise<void> {
    try {
      const now = new Date();
      const payload = omitUndefinedRecord({
        ...user,
        createdAt: user.createdAt ?? now,
        updatedAt: user.updatedAt ?? now,
      } as Record<string, unknown>);
      await this.db.collection(COLLECTION).doc(user.id).set(
        payload,
        { merge: true },
      );
    } catch (e) {
      throw new ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to create user', e);
    }
  }

  async updateUser(userId: string, patch: Partial<UserDoc>): Promise<void> {
    try {
      const payload = omitUndefinedRecord({
        ...patch,
        updatedAt: new Date(),
      } as Record<string, unknown>);
      await this.db
        .collection(COLLECTION)
        .doc(userId)
        .set(payload, { merge: true });
    } catch (e) {
      throw new ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to update user', e);
    }
  }

  async listUsers(params: { provider?: 'google' | 'steam'; keyword?: string; limit?: number }): Promise<UserDoc[]> {
    let q: Query = this.db.collection(COLLECTION).orderBy('updatedAt', 'desc');
    q = q.limit(Math.min(params.limit ?? 500, 1000));
    const snap = await q.get();
    let rows = snap.docs.map((d: QueryDocumentSnapshot) => d.data() as UserDoc);

    if (params.provider) {
      rows = rows.filter((r) => (r.authProviders ?? []).includes(params.provider!));
    }
    if (params.keyword) {
      const kw = params.keyword.toLowerCase();
      rows = rows.filter((r) =>
        [r.id, r.email, r.displayName, r.steamId, r.steamPersonaName].some((v) => String(v ?? '').toLowerCase().includes(kw)),
      );
    }

    return rows;
  }
}

