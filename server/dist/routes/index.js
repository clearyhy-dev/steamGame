"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRouter = createRouter;
const express_1 = __importDefault(require("express"));
const auth_routes_1 = require("../modules/auth/auth.routes");
const users_routes_1 = require("../modules/users/users.routes");
const steam_routes_1 = require("../modules/steam/steam.routes");
const favorites_routes_1 = require("../modules/favorites/favorites.routes");
function createRouter(env) {
    const r = express_1.default.Router();
    r.use('/auth', (0, auth_routes_1.authRouter)(env));
    r.use('/api', (0, users_routes_1.usersRouter)(env));
    r.use('/api/steam', (0, steam_routes_1.steamRouter)(env));
    r.use('/api/favorites', (0, favorites_routes_1.favoritesRouter)(env));
    return r;
}
