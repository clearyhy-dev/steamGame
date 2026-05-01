import jwt from 'jsonwebtoken';
import type { Env } from '../../config/env';

export type AdminJwtPayload = {
  role: 'admin';
  username: string;
};

export function signAdminJwt(payload: AdminJwtPayload, env: Env): string {
  const expiresIn = env.adminJwtExpiresIn as jwt.SignOptions['expiresIn'];
  return jwt.sign(
    {
      role: payload.role,
      username: payload.username,
    },
    env.adminJwtSecret,
    {
      expiresIn,
      subject: `admin:${payload.username}`,
    },
  );
}

export function verifyAdminJwt(token: string, env: Env): AdminJwtPayload {
  const decoded = jwt.verify(token, env.adminJwtSecret) as jwt.JwtPayload & AdminJwtPayload;
  if (decoded.role !== 'admin' || typeof decoded.username !== 'string') {
    throw new Error('Invalid admin token');
  }
  return { role: 'admin', username: decoded.username };
}
