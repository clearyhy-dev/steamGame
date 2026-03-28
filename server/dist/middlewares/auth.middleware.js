"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
const apiError_1 = require("../utils/apiError");
const jwt_1 = require("../config/jwt");
const env_1 = require("../config/env");
function authMiddleware(env = (0, env_1.loadEnv)()) {
    return (req, _res, next) => {
        const header = req.header('Authorization');
        if (!header || !header.startsWith('Bearer ')) {
            return next(new apiError_1.ApiError(401, 'UNAUTHORIZED', 'Missing Bearer token'));
        }
        const token = header.substring('Bearer '.length).trim();
        try {
            const payload = (0, jwt_1.verifyJwt)(token, env);
            req.auth = { userId: payload.userId };
            return next();
        }
        catch (_) {
            return next(new apiError_1.ApiError(401, 'JWT_INVALID', 'Invalid or expired token'));
        }
    };
}
