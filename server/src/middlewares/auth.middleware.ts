import type { Request, Response, NextFunction } from 'express';
import { ApiError } from '../utils/apiError';
import type { Env } from '../config/env';
import { loadEnv } from '../config/env';
import { verifyPlatformJwt, verifyLegacyJwt } from '../config/jwt';
import { introspectAuthToken } from '../modules/auth/auth-introspect.service';
import { ensureUserFromIntrospect } from '../modules/auth/auth-sync.service';

export type AuthContext = {
  userId: string;
  steamId?: string;
};

export type AuthedRequest = Request & { auth?: AuthContext };

export function authMiddleware(env: Env = loadEnv()) {
  return async (req: AuthedRequest, _res: Response, next: NextFunction) => {
    const header = req.header('Authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return next(new ApiError(401, 'UNAUTHORIZED', 'Missing Bearer token'));
    }
    const token = header.substring('Bearer '.length).trim();

    const platform = verifyPlatformJwt(token, env) ?? verifyLegacyJwt(token, env);
    if (platform) {
      req.auth = { userId: platform.userId };
      return next();
    }

    const intro = await introspectAuthToken(env, token);
    if (intro) {
      try {
        await ensureUserFromIntrospect(intro);
      } catch {
        /* non-fatal */
      }
      req.auth = { userId: intro.userId, steamId: intro.steamId };
      return next();
    }

    return next(new ApiError(401, 'JWT_INVALID', 'Invalid or expired token'));
  };
}

/** 可选鉴权：有 token 则解析，无 token 继续 */
export function optionalAuthMiddleware(env: Env = loadEnv()) {
  return async (req: AuthedRequest, _res: Response, next: NextFunction) => {
    const header = req.header('Authorization');
    if (!header || !header.startsWith('Bearer ')) return next();
    const token = header.substring('Bearer '.length).trim();
    const platform = verifyPlatformJwt(token, env) ?? verifyLegacyJwt(token, env);
    if (platform) {
      req.auth = { userId: platform.userId };
      return next();
    }
    const intro = await introspectAuthToken(env, token);
    if (intro) {
      req.auth = { userId: intro.userId, steamId: intro.steamId };
    }
    return next();
  };
}
