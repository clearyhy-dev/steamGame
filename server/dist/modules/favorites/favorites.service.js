"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FavoritesService = void 0;
const favorites_repository_1 = require("./favorites.repository");
const apiError_1 = require("../../utils/apiError");
class FavoritesService {
    repo = new favorites_repository_1.FavoritesRepository();
    constructor(_env) { }
    async list(userId) {
        return this.repo.listFavorites(userId);
    }
    async add(userId, input) {
        const appid = String(input.appid ?? '').trim();
        const name = String(input.name ?? '').trim();
        if (!appid)
            throw new apiError_1.ApiError(400, 'BAD_REQUEST', 'Missing appid');
        if (!name)
            throw new apiError_1.ApiError(400, 'BAD_REQUEST', 'Missing name');
        if (!input.source)
            throw new apiError_1.ApiError(400, 'BAD_REQUEST', 'Missing source');
        await this.repo.addFavorite(userId, {
            appid,
            name,
            headerImage: input.headerImage ?? '',
            source: input.source,
        });
    }
    async remove(userId, appid) {
        const id = String(appid ?? '').trim();
        if (!id)
            throw new apiError_1.ApiError(400, 'BAD_REQUEST', 'Missing appid');
        await this.repo.deleteFavorite(userId, id);
    }
}
exports.FavoritesService = FavoritesService;
