"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.favoritesRouter = favoritesRouter;
const express_1 = __importDefault(require("express"));
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const favorites_controller_1 = require("./favorites.controller");
function favoritesRouter(_env) {
    const router = express_1.default.Router();
    const controller = new favorites_controller_1.FavoritesController(_env);
    router.get('/', (0, auth_middleware_1.authMiddleware)(_env), controller.list);
    router.post('/', (0, auth_middleware_1.authMiddleware)(_env), controller.add);
    router.delete('/:appid', (0, auth_middleware_1.authMiddleware)(_env), controller.remove);
    return router;
}
