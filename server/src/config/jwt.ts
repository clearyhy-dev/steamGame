import jwt from 'jsonwebtoken';
import type { Env } from './env';
import { loadEnv } from './env';

export type JwtPayload = {
  userId: string;
};

export const AUTH_JWT_ISSUER = 'steamgame-auth';

/** 本服务（Vultr）签发的 App Session JWT */
export function signPlatformJwt(payload: JwtPayload, env: Env = loadEnv()): string {
  const expiresIn = env.jwtExpiresIn as jwt.SignOptions['expiresIn'];
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn,
    subject: payload.userId,
    issuer: env.jwtIssuer,
  });
}

/** 验证 Vultr 平台 JWT（iss=steamgame-api） */
export function verifyPlatformJwt(token: string, env: Env = loadEnv()): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret, { issuer: env.jwtIssuer }) as jwt.JwtPayload;
    const sub = decoded.sub;
    if (!sub || typeof sub !== 'string') return null;
    return { userId: sub };
  } catch {
    return null;
  }
}

/** 兼容旧版无 iss 的 JWT */
export function verifyLegacyJwt(token: string, env: Env = loadEnv()): JwtPayload | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
    if (decoded.iss && decoded.iss !== env.jwtIssuer) return null;
    const sub = decoded.sub;
    if (!sub || typeof sub !== 'string') return null;
    return { userId: sub };
  } catch {
    return null;
  }
}

/** @deprecated use signPlatformJwt */
export function signJwt(payload: JwtPayload, env: Env = loadEnv()): string {
  return signPlatformJwt(payload, env);
}

/** @deprecated use verifyPlatformJwt or verifyLegacyJwt */
export function verifyJwt(token: string, env: Env = loadEnv()): JwtPayload {
  const p = verifyPlatformJwt(token, env) ?? verifyLegacyJwt(token, env);
  if (!p) throw new Error('Invalid token');
  return p;
}
