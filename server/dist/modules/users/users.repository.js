"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersRepository = void 0;
const firebase_1 = require("../../config/firebase");
const apiError_1 = require("../../utils/apiError");
const COLLECTION = 'users';
class UsersRepository {
    db = (0, firebase_1.getFirestore)();
    async findById(userId) {
        const doc = await this.db.collection(COLLECTION).doc(userId).get();
        if (!doc.exists)
            return null;
        return doc.data();
    }
    async findBySteamId(steamId) {
        // Firestore index might be required in production.
        const snap = await this.db.collection(COLLECTION).where('steamId', '==', steamId).limit(1).get();
        if (snap.empty)
            return null;
        return snap.docs[0].data();
    }
    async createUser(user) {
        try {
            const now = new Date();
            await this.db.collection(COLLECTION).doc(user.id).set({
                ...user,
                createdAt: user.createdAt ?? now,
                updatedAt: user.updatedAt ?? now,
            }, { merge: true });
        }
        catch (e) {
            throw new apiError_1.ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to create user', e);
        }
    }
    async updateUser(userId, patch) {
        try {
            await this.db
                .collection(COLLECTION)
                .doc(userId)
                .set({ ...patch, updatedAt: new Date() }, { merge: true });
        }
        catch (e) {
            throw new apiError_1.ApiError(500, 'FIRESTORE_WRITE_FAILED', 'Failed to update user', e);
        }
    }
}
exports.UsersRepository = UsersRepository;
