"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SteamController = void 0;
const steam_service_1 = require("./steam.service");
const steam_repository_1 = require("./steam.repository");
const users_repository_1 = require("../users/users.repository");
const users_service_1 = require("../users/users.service");
const favorites_service_1 = require("../favorites/favorites.service");
const apiError_1 = require("../../utils/apiError");
const apiResponse_1 = require("../../utils/apiResponse");
async function safe(p) {
    try {
        const value = await p;
        return { ok: true, value };
    }
    catch (e) {
        return { ok: false, error: e?.message ?? String(e) };
    }
}
class SteamController {
    env;
    steam;
    users;
    constructor(env) {
        this.env = env;
        this.steam = new steam_service_1.SteamService(env);
        this.users = new users_repository_1.UsersRepository();
    }
    async getSteamId(req) {
        const userId = req.auth?.userId;
        if (!userId)
            throw new apiError_1.ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
        const user = await this.users.findById(userId);
        if (!user || !user.steamId)
            throw new apiError_1.ApiError(400, 'STEAM_NOT_BOUND', 'Steam account is not bound');
        return user.steamId;
    }
    friends = async (req, res) => {
        const steamId = await this.getSteamId(req);
        const status = await this.steam.getFriendsStatusCached(steamId, false);
        return (0, apiResponse_1.sendSuccess)(res, { friends: status.map((f) => ({ steamId: f.steamId, personaName: f.personaName })) });
    };
    friendsStatus = async (req, res) => {
        const steamId = await this.getSteamId(req);
        const status = await this.steam.getFriendsStatusCached(steamId, false);
        return (0, apiResponse_1.sendSuccess)(res, { friends: status });
    };
    gamesOwned = async (req, res) => {
        const steamId = await this.getSteamId(req);
        const { games, gameCount } = await this.steam.getOwnedGamesCached(steamId, false);
        return (0, apiResponse_1.sendSuccess)(res, { games, gameCount });
    };
    gamesRecent = async (req, res) => {
        const steamId = await this.getSteamId(req);
        const { games, totalCount } = await this.steam.getRecentGamesCached(steamId, false);
        return (0, apiResponse_1.sendSuccess)(res, { games, totalCount });
    };
    sync = async (req, res) => {
        const steamId = await this.getSteamId(req);
        const counts = await this.steam.forceSyncAll(steamId);
        return (0, apiResponse_1.sendSuccess)(res, { synced: true, ...counts });
    };
    /**
     * 一次返回当前 token 可拉取的主要 Steam / 应用数据（并行请求，单项失败不阻断其它字段）。
     */
    overview = async (req, res) => {
        const userId = req.auth?.userId;
        if (!userId)
            throw new apiError_1.ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
        const steamId = await this.getSteamId(req);
        const usersSvc = new users_service_1.UsersService(this.env);
        const favSvc = new favorites_service_1.FavoritesService(this.env);
        const steamRepo = new steam_repository_1.SteamRepository();
        const [profileR, ownedR, recentR, friendsR, favR, docR] = await Promise.all([
            safe(usersSvc.getSteamProfile(userId)),
            safe(this.steam.getOwnedGamesCached(steamId, false)),
            safe(this.steam.getRecentGamesCached(steamId, false)),
            safe(this.steam.getFriendsStatusCached(steamId, false)),
            safe(favSvc.list(userId)),
            safe(steamRepo.getSteamProfile(steamId)),
        ]);
        let totalPlaytimeMinutes = 0;
        if (ownedR.ok) {
            totalPlaytimeMinutes = ownedR.value.games.reduce((s, g) => s + (g.playtimeForever ?? 0), 0);
        }
        const extended = docR.ok && docR.value
            ? {
                countryCode: docR.value.countryCode ?? null,
                timeCreated: docR.value.timeCreated ?? null,
                realName: docR.value.realName ?? null,
                avatarFull: docR.value.avatarFull ?? null,
            }
            : null;
        return (0, apiResponse_1.sendSuccess)(res, {
            profile: profileR.ok ? profileR.value : null,
            profileError: profileR.ok ? null : profileR.error,
            extended,
            extendedError: docR.ok ? null : docR.error,
            owned: ownedR.ok
                ? {
                    games: ownedR.value.games,
                    gameCount: ownedR.value.gameCount,
                    totalPlaytimeMinutes,
                }
                : null,
            ownedError: ownedR.ok ? null : ownedR.error,
            recent: recentR.ok ? { games: recentR.value.games, totalCount: recentR.value.totalCount } : null,
            recentError: recentR.ok ? null : recentR.error,
            friends: friendsR.ok ? friendsR.value : null,
            friendsError: friendsR.ok ? null : friendsR.error,
            favorites: favR.ok ? favR.value : null,
            favoritesError: favR.ok ? null : favR.error,
        });
    };
}
exports.SteamController = SteamController;
