"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersRouter = usersRouter;
const express_1 = __importDefault(require("express"));
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const users_controller_1 = require("./users.controller");
function usersRouter(_env) {
    const router = express_1.default.Router();
    const controller = new users_controller_1.UsersController(_env);
    router.get('/me', (0, auth_middleware_1.authMiddleware)(_env), controller.me);
    router.get('/me/steam-profile', (0, auth_middleware_1.authMiddleware)(_env), controller.steamProfile);
    return router;
}
