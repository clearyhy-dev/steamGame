"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FavoritesController = void 0;
const favorites_service_1 = require("./favorites.service");
const apiResponse_1 = require("../../utils/apiResponse");
const apiError_1 = require("../../utils/apiError");
class FavoritesController {
    svc;
    constructor(env) {
        this.svc = new favorites_service_1.FavoritesService(env);
    }
    list = async (req, res) => {
        const userId = req.auth?.userId;
        if (!userId)
            throw new apiError_1.ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
        const items = await this.svc.list(userId);
        return (0, apiResponse_1.sendSuccess)(res, { favorites: items });
    };
    add = async (req, res) => {
        const userId = req.auth?.userId;
        if (!userId)
            throw new apiError_1.ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
        await this.svc.add(userId, req.body ?? {});
        return (0, apiResponse_1.sendSuccess)(res, { ok: true });
    };
    remove = async (req, res) => {
        const userId = req.auth?.userId;
        if (!userId)
            throw new apiError_1.ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
        const appid = String(req.params.appid ?? '');
        await this.svc.remove(userId, appid);
        return (0, apiResponse_1.sendSuccess)(res, { ok: true });
    };
}
exports.FavoritesController = FavoritesController;
