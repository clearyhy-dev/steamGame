import admin from 'firebase-admin';
import { getFirestore } from '../../config/firebase';
import type { FavoriteGame } from './favorites.types';
import { ApiError } from '../../utils/apiError';

const COLLECTION = 'user_favorites';

export class FavoritesRepository {
  private db = getFirestore();

  private docId(userId: string, appid: string) {
    return `${userId}_${appid}`;
  }

  async listFavorites(userId: string): Promise<FavoriteGame[]> {
    // 仅 equality 查询，避免 userId + orderBy(createdAt) 所需复合索引；排序在内存完成。
    const snap = await this.db.collection(COLLECTION).where('userId', '==', userId).get();

    const items = snap.docs.map((d) => d.data() as FavoriteGame);
    items.sort((a, b) => this._createdAtMs(b) - this._createdAtMs(a));
    return items;
  }

  private _createdAtMs(f: FavoriteGame): number {
    const c = f.createdAt as { toMillis?: () => number; seconds?: number } | undefined;
    if (!c) return 0;
    if (typeof c.toMillis === 'function') return c.toMillis();
    if (typeof c.seconds === 'number') return c.seconds * 1000;
    return 0;
  }

  async addFavorite(userId: string, favorite: Omit<FavoriteGame, 'createdAt'>): Promise<void> {
    try {
      const now = admin.firestore.Timestamp.now();
      await this.db
        .collection(COLLECTION)
        .doc(this.docId(userId, favorite.appid))
        .set(
          {
            userId,
            appid: favorite.appid,
            name: favorite.name,
            headerImage: favorite.headerImage ?? '',
            source: favorite.source,
            createdAt: now,
          },
          { merge: true },
        );
    } catch (e) {
      throw new ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to write favorite', e);
    }
  }

  async deleteFavorite(userId: string, appid: string): Promise<void> {
    try {
      await this.db.collection(COLLECTION).doc(this.docId(userId, appid)).delete();
    } catch (e) {
      throw new ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to delete favorite', e);
    }
  }
}

