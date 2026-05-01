import type { Response } from 'express';
import type { Env } from '../../config/env';
import { authMiddleware, type AuthedRequest } from '../../middlewares/auth.middleware';
import { sendSuccess } from '../../utils/apiResponse';
import { ApiError } from '../../utils/apiError';
import { UsersService } from './users.service';

export class UsersController {
  private svc: UsersService;

  constructor(private env: Env) {
    this.svc = new UsersService(env);
  }

  me = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const user = await this.svc.getMe(userId);
    return sendSuccess(res, {
      id: user.id,
      email: user.email ?? '',
      displayName: user.displayName ?? '',
      avatarUrl: user.avatarUrl ?? '',
      authProviders: user.authProviders ?? [],
      steamId: user.steamId ?? null,
      steamPersonaName: user.steamPersonaName ?? null,
      steamAvatar: user.steamAvatar ?? null,
      steamProfileUrl: user.steamProfileUrl ?? null,
      registeredAt: (user as any).registeredAtResolved
        ? (user as any).registeredAtResolved.toISOString()
        : null,
      trial: {
        days: (user as any).trialDays ?? 3,
        active: !!(user as any).trialActive,
        endsAt: (user as any).trialEndsAt ? (user as any).trialEndsAt.toISOString() : null,
        remainingSeconds: (user as any).trialRemainingSeconds ?? 0,
      },
    });
  };

  steamProfile = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const profile = await this.svc.getSteamProfile(userId);
    return sendSuccess(res, profile);
  };
}

