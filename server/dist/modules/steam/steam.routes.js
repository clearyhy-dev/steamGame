"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.steamRouter = steamRouter;
const express_1 = __importDefault(require("express"));
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const steam_controller_1 = require("./steam.controller");
function steamRouter(_env) {
    const router = express_1.default.Router();
    const controller = new steam_controller_1.SteamController(_env);
    router.get('/friends', (0, auth_middleware_1.authMiddleware)(_env), controller.friends);
    router.get('/friends/status', (0, auth_middleware_1.authMiddleware)(_env), controller.friendsStatus);
    router.get('/games/owned', (0, auth_middleware_1.authMiddleware)(_env), controller.gamesOwned);
    router.get('/games/recent', (0, auth_middleware_1.authMiddleware)(_env), controller.gamesRecent);
    router.get('/overview', (0, auth_middleware_1.authMiddleware)(_env), controller.overview);
    router.post('/sync', (0, auth_middleware_1.authMiddleware)(_env), controller.sync);
    return router;
}
