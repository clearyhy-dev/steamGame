import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/apiError';
import { verifyJwt } from '../config/jwt';
import type { Env } from '../config/env';
import { loadEnv } from '../config/env';

export type AuthContext = {
  userId: string;
};

export type AuthedRequest = Request & { auth?: AuthContext };

export function authMiddleware(env: Env = loadEnv()) {
  return (req: AuthedRequest, _res: Response, next: NextFunction) => {
    const header = req.header('Authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return next(new ApiError(401, 'UNAUTHORIZED', 'Missing Bearer token'));
    }
    const token = header.substring('Bearer '.length).trim();
    try {
      const payload = verifyJwt(token, env);
      req.auth = { userId: payload.userId };
      return next();
    } catch (_) {
      return next(new ApiError(401, 'JWT_INVALID', 'Invalid or expired token'));
    }
  };
}

