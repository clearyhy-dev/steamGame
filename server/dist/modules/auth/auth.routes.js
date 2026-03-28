"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authRouter = authRouter;
const express_1 = __importDefault(require("express"));
const auth_middleware_1 = require("../../middlewares/auth.middleware");
const auth_controller_1 = require("./auth.controller");
function authRouter(_env) {
    const router = express_1.default.Router();
    const controller = new auth_controller_1.AuthController(_env);
    router.get('/steam/start', controller.startSteam);
    router.get('/steam/callback', controller.callbackSteam);
    router.post('/steam/bind', (0, auth_middleware_1.authMiddleware)(_env), controller.bindSteam);
    router.post('/logout', (0, auth_middleware_1.authMiddleware)(_env), controller.logout);
    return router;
}
