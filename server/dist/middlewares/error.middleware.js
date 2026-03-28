"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorMiddleware = errorMiddleware;
const apiError_1 = require("../utils/apiError");
const logger_1 = require("../utils/logger");
function errorMiddleware(err, _req, res, _next) {
    if (res.headersSent)
        return;
    if (err instanceof apiError_1.ApiError) {
        logger_1.logger.warn(`API error ${err.code}: ${err.message}`);
        return res.status(err.statusCode).json({
            success: false,
            error: {
                code: err.code,
                message: err.message,
                details: err.details,
            },
        });
    }
    logger_1.logger.error(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
    return res.status(500).json({
        success: false,
        error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal server error',
        },
    });
}
