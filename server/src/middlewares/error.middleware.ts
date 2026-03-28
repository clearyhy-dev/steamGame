import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/apiError';
import { logger } from '../utils/logger';

export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (res.headersSent) return;

  if (err instanceof ApiError) {
    logger.warn(`API error ${err.code}: ${err.message}`);
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
  }

  logger.error(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    },
  });
}

