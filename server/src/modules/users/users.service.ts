import type { Env } from '../../config/env';
import { ApiError } from '../../utils/apiError';
import { UsersRepository } from './users.repository';
import type { UserDoc } from './users.types';

export class UsersService {
  private users = new UsersRepository();
  private static readonly TRIAL_DAYS = 3;

  constructor(_env: Env) {}

  private toDate(v: any): Date | null {
    if (!v) return null;
    try {
      if (v instanceof Date) return v;
      if (typeof v?.toDate === 'function') {
        const d = v.toDate();
        return d instanceof Date ? d : null;
      }
      if (typeof v === 'string') {
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
      }
      if (typeof v === 'number') {
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
      }
    } catch (_) {}
    return null;
  }

  private computeTrialMeta(user: UserDoc) {
    const now = new Date();
    const registeredAt =
      this.toDate((user as any).registeredAt) ??
      this.toDate((user as any).createdAt) ??
      now;
    const trialEndsAt = new Date(registeredAt.getTime() + UsersService.TRIAL_DAYS * 24 * 60 * 60 * 1000);
    const trialActive = trialEndsAt.getTime() > now.getTime();
    return {
      trialDays: UsersService.TRIAL_DAYS,
      registeredAt,
      trialEndsAt,
      trialActive,
      trialRemainingSeconds: trialActive ? Math.floor((trialEndsAt.getTime() - now.getTime()) / 1000) : 0,
    };
  }

  async getMe(userId: string): Promise<UserDoc & {
    trialDays: number;
    trialActive: boolean;
    trialRemainingSeconds: number;
    trialEndsAt: Date;
    registeredAtResolved: Date;
  }> {
    const user = await this.users.findById(userId);
    if (!user) throw new ApiError(404, 'UNAUTHORIZED', 'User not found');
    const trial = this.computeTrialMeta(user);
    return {
      ...user,
      trialDays: trial.trialDays,
      trialActive: trial.trialActive,
      trialRemainingSeconds: trial.trialRemainingSeconds,
      trialEndsAt: trial.trialEndsAt,
      registeredAtResolved: trial.registeredAt,
    };
  }

  async getSteamProfile(userId: string): Promise<{
    steamId: string;
    personaName: string;
    avatar: string;
    profileUrl: string;
  }> {
    const user = await this.users.findById(userId);
    if (!user) throw new ApiError(404, 'UNAUTHORIZED', 'User not found');
    if (!user.steamId || !user.steamPersonaName) {
      throw new ApiError(400, 'STEAM_NOT_BOUND', 'Steam account is not bound');
    }
    return {
      steamId: user.steamId,
      personaName: user.steamPersonaName,
      avatar: user.steamAvatar ?? '',
      profileUrl: user.steamProfileUrl ?? '',
    };
  }
}

