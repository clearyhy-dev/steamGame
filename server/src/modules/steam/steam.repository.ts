import { getFirestore } from '../../config/firebase';
import type {
  SteamFriendsCache,
  SteamOwnedGamesCache,
  SteamProfileDoc,
  SteamRecentGamesCache,
  SteamGame,
  SteamFriendStatus,
} from './steam.types';
import { ApiError } from '../../utils/apiError';
import { logger } from '../../utils/logger';

/** Firestore 拒绝 `undefined` 字段值，必须先去掉。 */
function omitUndefinedRecord(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const USERS_PROFILES_COLLECTION = 'steam_profiles';
const FRIENDS_CACHE_COLLECTION = 'steam_friends_cache';
const OWNED_CACHE_COLLECTION = 'steam_games_owned_cache';
const RECENT_CACHE_COLLECTION = 'steam_games_recent_cache';

export class SteamRepository {
  private db = getFirestore();

  async getSteamProfile(steamId: string): Promise<SteamProfileDoc | null> {
    const doc = await this.db.collection(USERS_PROFILES_COLLECTION).doc(steamId).get();
    if (!doc.exists) return null;
    return doc.data() as SteamProfileDoc;
  }

  async upsertSteamProfile(profile: Omit<SteamProfileDoc, 'lastFetchedAt'> & { lastFetchedAt?: any }): Promise<void> {
    try {
      const now = new Date();
      const payload = omitUndefinedRecord({
        ...profile,
        lastFetchedAt: profile.lastFetchedAt ?? now,
      } as Record<string, unknown>);
      await this.db.collection(USERS_PROFILES_COLLECTION).doc(profile.steamId).set(payload, { merge: true });
    } catch (e) {
      logger.error(`upsertSteamProfile failed: ${e instanceof Error ? e.message : String(e)}`);
      throw new ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to upsert steam profile', e);
    }
  }

  async getFriendsCache(ownerSteamId: string): Promise<SteamFriendsCache | null> {
    const doc = await this.db.collection(FRIENDS_CACHE_COLLECTION).doc(ownerSteamId).get();
    if (!doc.exists) return null;
    return doc.data() as SteamFriendsCache;
  }

  async setFriendsCache(ownerSteamId: string, friends: SteamFriendStatus[]): Promise<void> {
    try {
      await this.db
        .collection(FRIENDS_CACHE_COLLECTION)
        .doc(ownerSteamId)
        .set(
          {
            ownerSteamId,
            friends,
            lastFetchedAt: new Date(),
          },
          { merge: true },
        );
    } catch (e) {
      throw new ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to write friends cache', e);
    }
  }

  async getOwnedGamesCache(ownerSteamId: string): Promise<SteamOwnedGamesCache | null> {
    const doc = await this.db.collection(OWNED_CACHE_COLLECTION).doc(ownerSteamId).get();
    if (!doc.exists) return null;
    return doc.data() as SteamOwnedGamesCache;
  }

  async setOwnedGamesCache(ownerSteamId: string, games: SteamGame[], gameCount: number): Promise<void> {
    try {
      await this.db
        .collection(OWNED_CACHE_COLLECTION)
        .doc(ownerSteamId)
        .set(
          {
            ownerSteamId,
            games,
            gameCount,
            lastFetchedAt: new Date(),
          },
          { merge: true },
        );
    } catch (e) {
      throw new ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to write owned games cache', e);
    }
  }

  async getRecentGamesCache(ownerSteamId: string): Promise<SteamRecentGamesCache | null> {
    const doc = await this.db.collection(RECENT_CACHE_COLLECTION).doc(ownerSteamId).get();
    if (!doc.exists) return null;
    return doc.data() as SteamRecentGamesCache;
  }

  async setRecentGamesCache(ownerSteamId: string, games: SteamGame[], totalCount: number): Promise<void> {
    try {
      await this.db
        .collection(RECENT_CACHE_COLLECTION)
        .doc(ownerSteamId)
        .set(
          {
            ownerSteamId,
            games,
            totalCount,
            lastFetchedAt: new Date(),
          },
          { merge: true },
        );
    } catch (e) {
      throw new ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to write recent games cache', e);
    }
  }
}

