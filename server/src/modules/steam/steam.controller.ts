import type { Response } from 'express';
import type { Env } from '../../config/env';
import { SteamService } from './steam.service';
import { SteamRepository } from './steam.repository';
import { UsersRepository } from '../users/users.repository';
import { UsersService } from '../users/users.service';
import { FavoritesService } from '../favorites/favorites.service';
import { ApiError } from '../../utils/apiError';
import type { AuthedRequest } from '../../middlewares/auth.middleware';
import { sendSuccess } from '../../utils/apiResponse';

async function safe<T>(p: Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const value = await p;
    return { ok: true, value };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? String(e) };
  }
}

export class SteamController {
  private steam: SteamService;
  private users: UsersRepository;

  constructor(private env: Env) {
    this.steam = new SteamService(env);
    this.users = new UsersRepository();
  }

  private async getSteamId(req: AuthedRequest): Promise<string> {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const user = await this.users.findById(userId);
    if (!user || !user.steamId) throw new ApiError(400, 'STEAM_NOT_BOUND', 'Steam account is not bound');
    return user.steamId;
  }

  friends = async (req: AuthedRequest, res: Response) => {
    const steamId = await this.getSteamId(req);
    const status = await this.steam.getFriendsStatusCached(steamId, false);
    return sendSuccess(res, { friends: status.map((f) => ({ steamId: f.steamId, personaName: f.personaName })) });
  };

  friendsStatus = async (req: AuthedRequest, res: Response) => {
    const steamId = await this.getSteamId(req);
    const status = await this.steam.getFriendsStatusCached(steamId, false);
    return sendSuccess(res, { friends: status });
  };

  gamesOwned = async (req: AuthedRequest, res: Response) => {
    const steamId = await this.getSteamId(req);
    const { games, gameCount } = await this.steam.getOwnedGamesCached(steamId, false);
    return sendSuccess(res, { games, gameCount });
  };

  gamesRecent = async (req: AuthedRequest, res: Response) => {
    const steamId = await this.getSteamId(req);
    const { games, totalCount } = await this.steam.getRecentGamesCached(steamId, false);
    return sendSuccess(res, { games, totalCount });
  };

  sync = async (req: AuthedRequest, res: Response) => {
    const steamId = await this.getSteamId(req);
    const counts = await this.steam.forceSyncAll(steamId);
    return sendSuccess(res, { synced: true, ...counts });
  };

  /**
   * 一次返回当前 token 可拉取的主要 Steam / 应用数据（并行请求，单项失败不阻断其它字段）。
   */
  overview = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const steamId = await this.getSteamId(req);

    const usersSvc = new UsersService(this.env);
    const favSvc = new FavoritesService(this.env);
    const steamRepo = new SteamRepository();

    const [profileR, ownedR, recentR, friendsR, favR, docR] = await Promise.all([
      safe(usersSvc.getSteamProfile(userId)),
      safe(this.steam.getOwnedGamesCached(steamId, false)),
      safe(this.steam.getRecentGamesCached(steamId, false)),
      safe(this.steam.getFriendsStatusCached(steamId, false)),
      safe(favSvc.list(userId)),
      safe(steamRepo.getSteamProfile(steamId)),
    ]);

    let totalPlaytimeMinutes = 0;
    if (ownedR.ok) {
      totalPlaytimeMinutes = ownedR.value.games.reduce((s, g) => s + (g.playtimeForever ?? 0), 0);
    }

    const extended =
      docR.ok && docR.value
        ? {
            countryCode: docR.value.countryCode ?? null,
            timeCreated: docR.value.timeCreated ?? null,
            realName: docR.value.realName ?? null,
            avatarFull: docR.value.avatarFull ?? null,
          }
        : null;

    return sendSuccess(res, {
      profile: profileR.ok ? profileR.value : null,
      profileError: profileR.ok ? null : profileR.error,
      extended,
      extendedError: docR.ok ? null : docR.error,
      owned: ownedR.ok
        ? {
            games: ownedR.value.games,
            gameCount: ownedR.value.gameCount,
            totalPlaytimeMinutes,
          }
        : null,
      ownedError: ownedR.ok ? null : ownedR.error,
      recent: recentR.ok ? { games: recentR.value.games, totalCount: recentR.value.totalCount } : null,
      recentError: recentR.ok ? null : recentR.error,
      friends: friendsR.ok ? friendsR.value : null,
      friendsError: friendsR.ok ? null : friendsR.error,
      favorites: favR.ok ? favR.value : null,
      favoritesError: favR.ok ? null : favR.error,
    });
  };
}

