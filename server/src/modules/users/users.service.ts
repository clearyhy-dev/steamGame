import type { Env } from '../../config/env';
import { ApiError } from '../../utils/apiError';
import { UsersRepository } from './users.repository';
import type { UserDoc } from './users.types';

export class UsersService {
  private users = new UsersRepository();

  constructor(_env: Env) {}

  async getMe(userId: string): Promise<UserDoc> {
    const user = await this.users.findById(userId);
    if (!user) throw new ApiError(404, 'UNAUTHORIZED', 'User not found');
    return user;
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

