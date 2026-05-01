import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { signAdminJwt } from './admin.jwt';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import type { AdminAuthedRequest } from './adminAuth.middleware';
import { getEffectiveEnv } from '../../config/runtime-config';

export class AdminAuthController {
  constructor(private env: Env) {}

  login = async (req: Request, res: Response): Promise<void> => {
    const e = await getEffectiveEnv(this.env);
    const username = String(req.body?.username ?? '');
    const password = String(req.body?.password ?? '');

    if (!e.adminPassword) {
      sendAdminFail(res, 503, 'Admin login disabled: set ADMIN_PASSWORD');
      return;
    }
    if (username !== e.adminUsername || password !== e.adminPassword) {
      sendAdminFail(res, 401, 'Invalid credentials');
      return;
    }

    const token = signAdminJwt({ role: 'admin', username }, e);
    sendAdminOk(res, { token, username });
  };

  me = async (req: AdminAuthedRequest, res: Response): Promise<void> => {
    sendAdminOk(res, { username: req.admin!.username });
  };

  logout = async (_req: Request, res: Response): Promise<void> => {
    sendAdminOk(res, {}, 'Logged out');
  };
}
