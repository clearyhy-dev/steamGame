"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signJwt = signJwt;
exports.verifyJwt = verifyJwt;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const env_1 = require("./env");
function signJwt(payload, env = (0, env_1.loadEnv)()) {
    const expiresIn = env.jwtExpiresIn;
    return jsonwebtoken_1.default.sign(payload, env.jwtSecret, {
        expiresIn,
        subject: payload.userId,
    });
}
function verifyJwt(token, env = (0, env_1.loadEnv)()) {
    const decoded = jsonwebtoken_1.default.verify(token, env.jwtSecret);
    const sub = decoded.sub;
    if (!sub || typeof sub !== 'string')
        throw new Error('Invalid token');
    return { userId: sub };
}
