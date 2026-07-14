import type { Env } from '../../config/env';
import { ApiError } from '../../utils/apiError';
import { UsersRepository } from './users.repository';
import type { UserDoc, CountrySource } from './users.types';
import { FavoritesRepository } from '../favorites/favorites.repository';

export class UsersService {
  private users = new UsersRepository();
  private favorites = new FavoritesRepository();
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
    favoritesCount: number;
  }> {
    const user = await this.users.findById(userId);
    if (!user) throw new ApiError(404, 'UNAUTHORIZED', 'User not found');
    const trial = this.computeTrialMeta(user);
    let favoritesCount = 0;
    try {
      favoritesCount = (await this.favorites.listFavorites(userId)).length;
    } catch {
      favoritesCount = 0;
    }
    return {
      ...user,
      trialDays: trial.trialDays,
      trialActive: trial.trialActive,
      trialRemainingSeconds: trial.trialRemainingSeconds,
      trialEndsAt: trial.trialEndsAt,
      registeredAtResolved: trial.registeredAt,
      favoritesCount,
    };
  }

  async updateMe(
    userId: string,
    patch: { countryCode?: string; countrySource?: CountrySource },
  ): Promise<UserDoc> {
    const user = await this.users.findById(userId);
    if (!user) throw new ApiError(404, 'UNAUTHORIZED', 'User not found');
    const now = new Date();
    const updates: Partial<UserDoc> = { updatedAt: now };
    if (patch.countryCode != null) {
      const cc = String(patch.countryCode).trim().toUpperCase();
      if (cc.length !== 2) throw new ApiError(400, 'BAD_REQUEST', 'countryCode must be ISO-2');
      const source: CountrySource = patch.countrySource ?? 'manual';
      updates.countryCode = cc;
      updates.countrySource = source;
      updates.countryUpdatedAt = now;
      if (source === 'manual') {
        if (!user.defaultCountryCode && user.countryCode && user.countryCode !== cc) {
          updates.defaultCountryCode = user.countryCode;
        } else if (!user.defaultCountryCode) {
          updates.defaultCountryCode = cc;
        }
      } else {
        updates.defaultCountryCode = cc;
      }
    }
    await this.users.updateUser(userId, updates);
    const next = await this.users.findById(userId);
    if (!next) throw new ApiError(404, 'UNAUTHORIZED', 'User not found');
    return next;
  }

  async syncProSubscription(
    userId: string,
    input: { proUntilMs?: number | null; isPro?: boolean },
  ): Promise<UserDoc> {
    const user = await this.users.findById(userId);
    if (!user) throw new ApiError(404, 'UNAUTHORIZED', 'User not found');
    const now = Date.now();
    let proUntilMs = input.proUntilMs;
    if (proUntilMs == null && input.isPro === true) {
      proUntilMs = now + 365 * 24 * 3600_000;
    }
    if (proUntilMs != null && (!Number.isFinite(proUntilMs) || proUntilMs < now - 60_000)) {
      proUntilMs = now;
    }
    await this.users.updateUser(userId, {
      proUntilMs: proUntilMs ?? undefined,
      updatedAt: new Date(),
    });
    const next = await this.users.findById(userId);
    if (!next) throw new ApiError(404, 'UNAUTHORIZED', 'User not found');
    return next;
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

