"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FavoritesRepository = void 0;
const firebase_admin_1 = __importDefault(require("firebase-admin"));
const firebase_1 = require("../../config/firebase");
const apiError_1 = require("../../utils/apiError");
const COLLECTION = 'user_favorites';
class FavoritesRepository {
    db = (0, firebase_1.getFirestore)();
    docId(userId, appid) {
        return `${userId}_${appid}`;
    }
    async listFavorites(userId) {
        // 仅 equality 查询，避免 userId + orderBy(createdAt) 所需复合索引；排序在内存完成。
        const snap = await this.db.collection(COLLECTION).where('userId', '==', userId).get();
        const items = snap.docs.map((d) => d.data());
        items.sort((a, b) => this._createdAtMs(b) - this._createdAtMs(a));
        return items;
    }
    _createdAtMs(f) {
        const c = f.createdAt;
        if (!c)
            return 0;
        if (typeof c.toMillis === 'function')
            return c.toMillis();
        if (typeof c.seconds === 'number')
            return c.seconds * 1000;
        return 0;
    }
    async addFavorite(userId, favorite) {
        try {
            const now = firebase_admin_1.default.firestore.Timestamp.now();
            await this.db
                .collection(COLLECTION)
                .doc(this.docId(userId, favorite.appid))
                .set({
                userId,
                appid: favorite.appid,
                name: favorite.name,
                headerImage: favorite.headerImage ?? '',
                source: favorite.source,
                createdAt: now,
            }, { merge: true });
        }
        catch (e) {
            throw new apiError_1.ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to write favorite', e);
        }
    }
    async deleteFavorite(userId, appid) {
        try {
            await this.db.collection(COLLECTION).doc(this.docId(userId, appid)).delete();
        }
        catch (e) {
            throw new apiError_1.ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to delete favorite', e);
        }
    }
}
exports.FavoritesRepository = FavoritesRepository;
