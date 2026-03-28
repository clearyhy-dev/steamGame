import jwt from 'jsonwebtoken';
import type { Env } from './env';
import { loadEnv } from './env';

export type JwtPayload = {
  userId: string;
};

export function signJwt(payload: JwtPayload, env: Env = loadEnv()): string {
  const expiresIn = env.jwtExpiresIn as jwt.SignOptions['expiresIn'];
  return jwt.sign(payload, env.jwtSecret, {
    expiresIn,
    subject: payload.userId,
  });
}

export function verifyJwt(token: string, env: Env = loadEnv()): JwtPayload {
  const decoded = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
  const sub = decoded.sub;
  if (!sub || typeof sub !== 'string') throw new Error('Invalid token');
  return { userId: sub };
}

