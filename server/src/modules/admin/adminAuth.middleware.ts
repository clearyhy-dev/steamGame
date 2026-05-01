import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../../config/env';
import { verifyAdminJwt } from './admin.jwt';
import { sendAdminFail } from '../../utils/adminJson';

export type AdminAuthedRequest = Request & { admin?: { username: string } };

export function adminAuthMiddleware(env: Env) {
  return (req: AdminAuthedRequest, res: Response, next: NextFunction) => {
    const header = req.header('Authorization');
    if (!header || !header.startsWith('Bearer ')) {
      return sendAdminFail(res, 401, 'Missing Bearer token');
    }
    const token = header.substring('Bearer '.length).trim();
    try {
      const payload = verifyAdminJwt(token, env);
      req.admin = { username: payload.username };
      return next();
    } catch {
      return sendAdminFail(res, 401, 'Invalid or expired token');
    }
  };
}
