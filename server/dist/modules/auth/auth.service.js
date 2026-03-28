"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const jwt_1 = require("../../config/jwt");
const apiError_1 = require("../../utils/apiError");
const users_repository_1 = require("../users/users.repository");
const steam_repository_1 = require("../steam/steam.repository");
class AuthService {
    env;
    users = new users_repository_1.UsersRepository();
    steamRepo = new steam_repository_1.SteamRepository();
    constructor(env) {
        this.env = env;
    }
    buildUserIdForSteamLogin(steamId) {
        return `u_${steamId}`;
    }
    async loginOrBindSteam(input) {
        const { mode, steamId, steamProfile } = input;
        if (mode === 'bind') {
            const appUserId = input.appUserId?.trim();
            if (!appUserId)
                throw new apiError_1.ApiError(400, 'BAD_REQUEST', 'Missing appUserId for bind mode');
            const existingSteamUser = await this.users.findBySteamId(steamId);
            if (existingSteamUser && existingSteamUser.id !== appUserId) {
                throw new apiError_1.ApiError(409, 'STEAM_ALREADY_BOUND', 'This Steam account is already bound to another user');
            }
            const user = await this.users.findById(appUserId);
            const now = new Date();
            if (!user) {
                await this.users.createUser({
                    id: appUserId,
                    email: input.appEmail ?? '',
                    displayName: input.appEmail ? input.appEmail.split('@')[0] : 'Google User',
                    avatarUrl: input.appPhotoUrl ?? '',
                    authProviders: ['google', 'steam'],
                    steamId,
                    steamPersonaName: steamProfile.personaName,
                    steamAvatar: steamProfile.avatarFull || steamProfile.avatar || '',
                    steamProfileUrl: steamProfile.profileUrl,
                    createdAt: now,
                    updatedAt: now,
                });
            }
            else {
                const providers = new Set(user.authProviders ?? []);
                providers.add('steam');
                await this.users.updateUser(appUserId, {
                    authProviders: Array.from(providers),
                    steamId,
                    steamPersonaName: steamProfile.personaName,
                    steamAvatar: steamProfile.avatarFull || steamProfile.avatar || '',
                    steamProfileUrl: steamProfile.profileUrl,
                    updatedAt: now,
                });
            }
            // Update steam profile cache & link
            await this.steamRepo.upsertSteamProfile({
                steamId,
                personaName: steamProfile.personaName,
                avatar: steamProfile.avatar,
                avatarFull: steamProfile.avatarFull,
                profileUrl: steamProfile.profileUrl,
                countryCode: steamProfile.countryCode,
                linkedUserId: appUserId,
            });
            const token = (0, jwt_1.signJwt)({ userId: appUserId }, this.env);
            return { token, userId: appUserId, steamId };
        }
        // mode === 'login'
        const existing = await this.users.findBySteamId(steamId);
        if (existing) {
            await this.steamRepo.upsertSteamProfile({
                steamId,
                personaName: steamProfile.personaName,
                avatar: steamProfile.avatar,
                avatarFull: steamProfile.avatarFull,
                profileUrl: steamProfile.profileUrl,
                countryCode: steamProfile.countryCode,
                linkedUserId: existing.id,
            });
            const token = (0, jwt_1.signJwt)({ userId: existing.id }, this.env);
            return { token, userId: existing.id, steamId };
        }
        // New local user
        const userId = this.buildUserIdForSteamLogin(steamId);
        const now = new Date();
        await this.users.createUser({
            id: userId,
            email: '',
            displayName: steamProfile.personaName,
            avatarUrl: steamProfile.avatarFull || steamProfile.avatar || '',
            authProviders: ['steam'],
            steamId,
            steamPersonaName: steamProfile.personaName,
            steamAvatar: steamProfile.avatarFull || steamProfile.avatar || '',
            steamProfileUrl: steamProfile.profileUrl,
            createdAt: now,
            updatedAt: now,
        });
        await this.steamRepo.upsertSteamProfile({
            steamId,
            personaName: steamProfile.personaName,
            avatar: steamProfile.avatar,
            avatarFull: steamProfile.avatarFull,
            profileUrl: steamProfile.profileUrl,
            countryCode: steamProfile.countryCode,
            linkedUserId: userId,
        });
        const token = (0, jwt_1.signJwt)({ userId }, this.env);
        return { token, userId, steamId };
    }
    async bindSteamToAuthenticatedUser(input) {
        const userId = input.userId.trim();
        if (!userId)
            throw new apiError_1.ApiError(400, 'BAD_REQUEST', 'Invalid userId');
        const existingSteamUser = await this.users.findBySteamId(input.steamId);
        if (existingSteamUser && existingSteamUser.id !== userId) {
            throw new apiError_1.ApiError(409, 'STEAM_ALREADY_BOUND', 'This Steam account is already bound to another user');
        }
        const providers = new Set(['steam']);
        const user = await this.users.findById(userId);
        if (user?.authProviders?.length) {
            for (const p of user.authProviders)
                providers.add(p);
        }
        await this.users.updateUser(userId, {
            authProviders: Array.from(providers),
            steamId: input.steamId,
            steamPersonaName: input.steamProfile.personaName,
            steamAvatar: input.steamProfile.avatarFull || input.steamProfile.avatar || '',
            steamProfileUrl: input.steamProfile.profileUrl,
        });
        await this.steamRepo.upsertSteamProfile({
            steamId: input.steamId,
            personaName: input.steamProfile.personaName,
            avatar: input.steamProfile.avatar,
            avatarFull: input.steamProfile.avatarFull,
            profileUrl: input.steamProfile.profileUrl,
            countryCode: input.steamProfile.countryCode,
            linkedUserId: userId,
        });
        const token = (0, jwt_1.signJwt)({ userId }, this.env);
        return { token, userId, steamId: input.steamId };
    }
}
exports.AuthService = AuthService;
