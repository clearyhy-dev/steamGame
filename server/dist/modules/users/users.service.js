"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UsersService = void 0;
const apiError_1 = require("../../utils/apiError");
const users_repository_1 = require("./users.repository");
class UsersService {
    users = new users_repository_1.UsersRepository();
    constructor(_env) { }
    async getMe(userId) {
        const user = await this.users.findById(userId);
        if (!user)
            throw new apiError_1.ApiError(404, 'UNAUTHORIZED', 'User not found');
        return user;
    }
    async getSteamProfile(userId) {
        const user = await this.users.findById(userId);
        if (!user)
            throw new apiError_1.ApiError(404, 'UNAUTHORIZED', 'User not found');
        if (!user.steamId || !user.steamPersonaName) {
            throw new apiError_1.ApiError(400, 'STEAM_NOT_BOUND', 'Steam account is not bound');
        }
        return {
            steamId: user.steamId,
            personaName: user.steamPersonaName,
            avatar: user.steamAvatar ?? '',
            profileUrl: user.steamProfileUrl ?? '',
        };
    }
}
exports.UsersService = UsersService;
