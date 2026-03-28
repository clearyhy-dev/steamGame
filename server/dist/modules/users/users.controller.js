"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersController = void 0;
const apiResponse_1 = require("../../utils/apiResponse");
const apiError_1 = require("../../utils/apiError");
const users_service_1 = require("./users.service");
class UsersController {
    env;
    svc;
    constructor(env) {
        this.env = env;
        this.svc = new users_service_1.UsersService(env);
    }
    me = async (req, res) => {
        const userId = req.auth?.userId;
        if (!userId)
            throw new apiError_1.ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
        const user = await this.svc.getMe(userId);
        return (0, apiResponse_1.sendSuccess)(res, {
            id: user.id,
            email: user.email ?? '',
            displayName: user.displayName ?? '',
            avatarUrl: user.avatarUrl ?? '',
            authProviders: user.authProviders ?? [],
            steamId: user.steamId ?? null,
            steamPersonaName: user.steamPersonaName ?? null,
            steamAvatar: user.steamAvatar ?? null,
            steamProfileUrl: user.steamProfileUrl ?? null,
        });
    };
    steamProfile = async (req, res) => {
        const userId = req.auth?.userId;
        if (!userId)
            throw new apiError_1.ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
        const profile = await this.svc.getSteamProfile(userId);
        return (0, apiResponse_1.sendSuccess)(res, profile);
    };
}
exports.UsersController = UsersController;
