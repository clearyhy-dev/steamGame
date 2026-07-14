import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { signPlatformJwt } from '../../config/jwt';
import { UsersRepository } from '../users/users.repository';
import { ApiError } from '../../utils/apiError';
import { sendSuccess } from '../../utils/apiResponse';
import type { AuthProvider } from '../users/users.types';

export class AppSessionController {
  private users = new UsersRepository();

  constructor(private env: Env) {}

  /** Google 本地登录桥接：创建/查找用户并签发 Vultr 平台 JWT */
  createAppSession = async (req: Request, res: Response): Promise<void> => {
    const googleUserId = String(req.body?.googleUserId ?? req.body?.userId ?? '').trim();
    if (!googleUserId) throw new ApiError(400, 'BAD_REQUEST', 'Missing googleUserId');

    const email = String(req.body?.email ?? '').trim();
    const displayName = String(req.body?.displayName ?? '').trim();
    const photoUrl = String(req.body?.photoUrl ?? req.body?.avatarUrl ?? '').trim();
    const userId = googleUserId.startsWith('google_') ? googleUserId : `google_${googleUserId}`;

    const existing = await this.users.findById(userId);
    const now = new Date();
    if (!existing) {
      await this.users.createUser({
        id: userId,
        email,
        displayName: displayName || (email ? email.split('@')[0] : 'User'),
        avatarUrl: photoUrl,
        authProviders: ['google'] as AuthProvider[],
        googleSub: googleUserId,
        registeredAt: now,
        createdAt: now,
        updatedAt: now,
      });
    } else {
      await this.users.updateUser(userId, {
        email: email || existing.email,
        displayName: displayName || existing.displayName,
        avatarUrl: photoUrl || existing.avatarUrl,
        googleSub: googleUserId,
        updatedAt: now,
      });
    }

    const token = signPlatformJwt({ userId }, this.env);
    sendSuccess(res, { token, userId });
  };
}
