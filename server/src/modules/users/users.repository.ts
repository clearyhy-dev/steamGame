import { getFirestore } from '../../config/firebase';
import type { UserDoc } from './users.types';
import { ApiError } from '../../utils/apiError';

const COLLECTION = 'users';

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
      await this.db.collection(COLLECTION).doc(user.id).set(
        {
          ...user,
          createdAt: user.createdAt ?? now,
          updatedAt: user.updatedAt ?? now,
        },
        { merge: true },
      );
    } catch (e) {
      throw new ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to create user', e);
    }
  }

  async updateUser(userId: string, patch: Partial<UserDoc>): Promise<void> {
    try {
      await this.db
        .collection(COLLECTION)
        .doc(userId)
        .set({ ...patch, updatedAt: new Date() }, { merge: true });
    } catch (e) {
      throw new ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to update user', e);
    }
  }
}

