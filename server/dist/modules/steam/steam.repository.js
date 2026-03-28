"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SteamRepository = void 0;
const firebase_1 = require("../../config/firebase");
const apiError_1 = require("../../utils/apiError");
const logger_1 = require("../../utils/logger");
/** Firestore 拒绝 `undefined` 字段值，必须先去掉。 */
function omitUndefinedRecord(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v !== undefined)
            out[k] = v;
    }
    return out;
}
const USERS_PROFILES_COLLECTION = 'steam_profiles';
const FRIENDS_CACHE_COLLECTION = 'steam_friends_cache';
const OWNED_CACHE_COLLECTION = 'steam_games_owned_cache';
const RECENT_CACHE_COLLECTION = 'steam_games_recent_cache';
class SteamRepository {
    db = (0, firebase_1.getFirestore)();
    async getSteamProfile(steamId) {
        const doc = await this.db.collection(USERS_PROFILES_COLLECTION).doc(steamId).get();
        if (!doc.exists)
            return null;
        return doc.data();
    }
    async upsertSteamProfile(profile) {
        try {
            const now = new Date();
            const payload = omitUndefinedRecord({
                ...profile,
                lastFetchedAt: profile.lastFetchedAt ?? now,
            });
            await this.db.collection(USERS_PROFILES_COLLECTION).doc(profile.steamId).set(payload, { merge: true });
        }
        catch (e) {
            logger_1.logger.error(`upsertSteamProfile failed: ${e instanceof Error ? e.message : String(e)}`);
            throw new apiError_1.ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to upsert steam profile', e);
        }
    }
    async getFriendsCache(ownerSteamId) {
        const doc = await this.db.collection(FRIENDS_CACHE_COLLECTION).doc(ownerSteamId).get();
        if (!doc.exists)
            return null;
        return doc.data();
    }
    async setFriendsCache(ownerSteamId, friends) {
        try {
            await this.db
                .collection(FRIENDS_CACHE_COLLECTION)
                .doc(ownerSteamId)
                .set({
                ownerSteamId,
                friends,
                lastFetchedAt: new Date(),
            }, { merge: true });
        }
        catch (e) {
            throw new apiError_1.ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to write friends cache', e);
        }
    }
    async getOwnedGamesCache(ownerSteamId) {
        const doc = await this.db.collection(OWNED_CACHE_COLLECTION).doc(ownerSteamId).get();
        if (!doc.exists)
            return null;
        return doc.data();
    }
    async setOwnedGamesCache(ownerSteamId, games, gameCount) {
        try {
            await this.db
                .collection(OWNED_CACHE_COLLECTION)
                .doc(ownerSteamId)
                .set({
                ownerSteamId,
                games,
                gameCount,
                lastFetchedAt: new Date(),
            }, { merge: true });
        }
        catch (e) {
            throw new apiError_1.ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to write owned games cache', e);
        }
    }
    async getRecentGamesCache(ownerSteamId) {
        const doc = await this.db.collection(RECENT_CACHE_COLLECTION).doc(ownerSteamId).get();
        if (!doc.exists)
            return null;
        return doc.data();
    }
    async setRecentGamesCache(ownerSteamId, games, totalCount) {
        try {
            await this.db
                .collection(RECENT_CACHE_COLLECTION)
                .doc(ownerSteamId)
                .set({
                ownerSteamId,
                games,
                totalCount,
                lastFetchedAt: new Date(),
            }, { merge: true });
        }
        catch (e) {
            throw new apiError_1.ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to write recent games cache', e);
        }
    }
}
exports.SteamRepository = SteamRepository;
