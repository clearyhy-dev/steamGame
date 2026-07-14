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
      countryCode: user.countryCode ?? null,
      countrySource: user.countrySource ?? null,
      favoritesCount: user.favoritesCount ?? 0,
      registeredAt: (user as any).registeredAtResolved
        ? (user as any).registeredAtResolved.toISOString()
        : null,
      trial: {
        days: (user as any).trialDays ?? 3,
        active: !!(user as any).trialActive,
        endsAt: (user as any).trialEndsAt ? (user as any).trialEndsAt.toISOString() : null,
        remainingSeconds: (user as any).trialRemainingSeconds ?? 0,
      },
      proUntilMs: user.proUntilMs ?? null,
      isPro: !!(user.proUntilMs && user.proUntilMs > Date.now()),
    });
  };

  syncSubscription = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const proUntilMs =
      req.body?.proUntilMs != null
        ? Number(req.body.proUntilMs)
        : req.body?.pro_until_ms != null
          ? Number(req.body.pro_until_ms)
          : undefined;
    const user = await this.svc.syncProSubscription(userId, {
      proUntilMs: Number.isFinite(proUntilMs) ? proUntilMs : undefined,
      isPro: req.body?.isPro === true || req.body?.is_pro === true,
    });
    return sendSuccess(res, {
      proUntilMs: user.proUntilMs ?? null,
      isPro: !!(user.proUntilMs && user.proUntilMs > Date.now()),
    });
  };

  patchMe = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const countryCode = req.body?.countryCode ?? req.body?.country_code;
    const countrySource = req.body?.countrySource ?? req.body?.country_source;
    const user = await this.svc.updateMe(userId, {
      countryCode: countryCode != null ? String(countryCode) : undefined,
      countrySource: countrySource != null ? (String(countrySource) as any) : undefined,
    });
    return sendSuccess(res, {
      id: user.id,
      countryCode: user.countryCode ?? null,
      countrySource: user.countrySource ?? null,
    });
  };

  steamProfile = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const profile = await this.svc.getSteamProfile(userId);
    return sendSuccess(res, profile);
  };
}

