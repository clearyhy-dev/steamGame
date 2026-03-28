import type { Env } from '../../config/env';
import { signJwt } from '../../config/jwt';
import { ApiError } from '../../utils/apiError';
import { UsersRepository } from '../users/users.repository';
import { SteamRepository } from '../steam/steam.repository';
import type { AuthProvider } from '../users/users.types';

import type { SteamPlayerSummary } from '../steam/steam.types';

export type SteamLoginMode = 'login' | 'bind';

export type SteamLoginResult = {
  token: string;
  userId: string;
  steamId: string;
};

export class AuthService {
  private users = new UsersRepository();
  private steamRepo = new SteamRepository();

  constructor(private env: Env) {}

  private buildUserIdForSteamLogin(steamId: string): string {
    return `u_${steamId}`;
  }

  async loginOrBindSteam(input: {
    mode: SteamLoginMode;
    steamId: string;
    appUserId?: string;
    appEmail?: string;
    appPhotoUrl?: string;
    steamProfile: SteamPlayerSummary;
  }): Promise<SteamLoginResult> {
    const { mode, steamId, steamProfile } = input;

    if (mode === 'bind') {
      const appUserId = input.appUserId?.trim();
      if (!appUserId) throw new ApiError(400, 'BAD_REQUEST', 'Missing appUserId for bind mode');

      const existingSteamUser = await this.users.findBySteamId(steamId);
      if (existingSteamUser && existingSteamUser.id !== appUserId) {
        throw new ApiError(409, 'STEAM_ALREADY_BOUND', 'This Steam account is already bound to another user');
      }

      const user = await this.users.findById(appUserId);
      const now = new Date();

      if (!user) {
        await this.users.createUser({
          id: appUserId,
          email: input.appEmail ?? '',
          displayName: input.appEmail ? input.appEmail.split('@')[0] : 'Google User',
          avatarUrl: input.appPhotoUrl ?? '',
          authProviders: ['google', 'steam'],
          steamId,
          steamPersonaName: steamProfile.personaName,
          steamAvatar: steamProfile.avatarFull || steamProfile.avatar || '',
          steamProfileUrl: steamProfile.profileUrl,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        const providers = new Set(user.authProviders ?? []);
        providers.add('steam');

        await this.users.updateUser(appUserId, {
          authProviders: Array.from(providers),
          steamId,
          steamPersonaName: steamProfile.personaName,
          steamAvatar: steamProfile.avatarFull || steamProfile.avatar || '',
          steamProfileUrl: steamProfile.profileUrl,
          updatedAt: now,
        });
      }

      // Update steam profile cache & link
      await this.steamRepo.upsertSteamProfile({
        steamId,
        personaName: steamProfile.personaName,
        avatar: steamProfile.avatar,
        avatarFull: steamProfile.avatarFull,
        profileUrl: steamProfile.profileUrl,
        countryCode: steamProfile.countryCode,
        linkedUserId: appUserId,
      });

      const token = signJwt({ userId: appUserId }, this.env);
      return { token, userId: appUserId, steamId };
    }

    // mode === 'login'
    const existing = await this.users.findBySteamId(steamId);
    if (existing) {
      await this.steamRepo.upsertSteamProfile({
        steamId,
        personaName: steamProfile.personaName,
        avatar: steamProfile.avatar,
        avatarFull: steamProfile.avatarFull,
        profileUrl: steamProfile.profileUrl,
        countryCode: steamProfile.countryCode,
        linkedUserId: existing.id,
      });
      const token = signJwt({ userId: existing.id }, this.env);
      return { token, userId: existing.id, steamId };
    }

    // New local user
    const userId = this.buildUserIdForSteamLogin(steamId);
    const now = new Date();
    await this.users.createUser({
      id: userId,
      email: '',
      displayName: steamProfile.personaName,
      avatarUrl: steamProfile.avatarFull || steamProfile.avatar || '',
      authProviders: ['steam'],
      steamId,
      steamPersonaName: steamProfile.personaName,
      steamAvatar: steamProfile.avatarFull || steamProfile.avatar || '',
      steamProfileUrl: steamProfile.profileUrl,
      createdAt: now,
      updatedAt: now,
    });

    await this.steamRepo.upsertSteamProfile({
      steamId,
      personaName: steamProfile.personaName,
      avatar: steamProfile.avatar,
      avatarFull: steamProfile.avatarFull,
      profileUrl: steamProfile.profileUrl,
      countryCode: steamProfile.countryCode,
      linkedUserId: userId,
    });

    const token = signJwt({ userId }, this.env);
    return { token, userId, steamId };
  }

  async bindSteamToAuthenticatedUser(input: { userId: string; steamId: string; steamProfile: SteamPlayerSummary }) {
    const userId = input.userId.trim();
    if (!userId) throw new ApiError(400, 'BAD_REQUEST', 'Invalid userId');

    const existingSteamUser = await this.users.findBySteamId(input.steamId);
    if (existingSteamUser && existingSteamUser.id !== userId) {
      throw new ApiError(409, 'STEAM_ALREADY_BOUND', 'This Steam account is already bound to another user');
    }

    const providers = new Set<AuthProvider>(['steam']);

    const user = await this.users.findById(userId);
    if (user?.authProviders?.length) {
      for (const p of user.authProviders) providers.add(p);
    }

    await this.users.updateUser(userId, {
      authProviders: Array.from(providers),
      steamId: input.steamId,
      steamPersonaName: input.steamProfile.personaName,
      steamAvatar: input.steamProfile.avatarFull || input.steamProfile.avatar || '',
      steamProfileUrl: input.steamProfile.profileUrl,
    });

    await this.steamRepo.upsertSteamProfile({
      steamId: input.steamId,
      personaName: input.steamProfile.personaName,
      avatar: input.steamProfile.avatar,
      avatarFull: input.steamProfile.avatarFull,
      profileUrl: input.steamProfile.profileUrl,
      countryCode: input.steamProfile.countryCode,
      linkedUserId: userId,
    });

    const token = signJwt({ userId }, this.env);
    return { token, userId, steamId: input.steamId };
  }
}

