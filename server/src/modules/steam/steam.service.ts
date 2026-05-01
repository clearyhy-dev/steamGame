import type { Env } from '../../config/env';
import { ApiError } from '../../utils/apiError';
import { SteamRepository } from './steam.repository';
import type {
  SteamFriendStatus,
  SteamGame,
  SteamOwnedGamesCache,
  SteamPlayerSummary,
  SteamRecentGamesCache,
  SteamFriendsCache,
  SteamProfileDoc,
} from './steam.types';
import axios from 'axios';
import { getEffectiveEnv } from '../../config/runtime-config';

const STEAM_API_BASE = 'https://api.steampowered.com';
const GET_PLAYER_SUMMARIES = `${STEAM_API_BASE}/ISteamUser/GetPlayerSummaries/v2/`;
const GET_FRIEND_LIST = `${STEAM_API_BASE}/ISteamUser/GetFriendList/v1/`;
const GET_OWNED_GAMES = `${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/`;
const GET_RECENTLY_PLAYED = `${STEAM_API_BASE}/IPlayerService/GetRecentlyPlayedGames/v1/`;

export class SteamService {
  private steamRepo: SteamRepository;

  private FRIENDS_TTL_MS = 10 * 60 * 1000;
  private OWNED_TTL_MS = 24 * 60 * 60 * 1000;
  private RECENT_TTL_MS = 1 * 60 * 60 * 1000;

  constructor(private env: Env) {
    this.steamRepo = new SteamRepository();
  }

  private toMs(ts: any): number {
    try {
      if (!ts) return 0;
      if (typeof ts === 'number') return ts;
      if (ts instanceof Date) return ts.getTime();
      if (typeof ts === 'string') return Date.parse(ts);
      // Firestore Timestamp
      if (typeof ts.toMillis === 'function') return ts.toMillis();
      if (typeof ts.toDate === 'function') return ts.toDate().getTime();
    } catch (_) {}
    return 0;
  }

  private isFresh(ts: any, ttlMs: number) {
    const t = this.toMs(ts);
    return t > 0 && Date.now() - t < ttlMs;
  }

  mapPersonaState(state: number): { state: number; label: string } {
    // Steam persona_state:
    // 0 Offline, 1 Online, 2 Busy, 3 Away, 4 Snooze, 5 Looking to trade, 6 Looking to play
    const map: Record<number, string> = {
      0: 'Offline',
      1: 'Online',
      2: 'Busy',
      3: 'Away',
      4: 'Snooze',
      5: 'Looking to trade',
      6: 'Looking to play',
    };
    return { state, label: map[state] ?? 'Unknown' };
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
  }

  async getPlayerSummaries(steamIds: string[]): Promise<SteamPlayerSummary[]> {
    const e = await getEffectiveEnv(this.env);
    if (!String(e.steamApiKey ?? '').trim()) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'STEAM_API_KEY is not configured (env or admin runtime settings)');
    }
    const ids = [...new Set(steamIds.filter(Boolean))];
    if (ids.length === 0) return [];

    const results: SteamPlayerSummary[] = [];

    for (const batch of this.chunkArray(ids, 100)) {
      try {
        const resp = await axios.get(GET_PLAYER_SUMMARIES, {
          timeout: e.steamHttpTimeoutMs,
          params: {
            key: e.steamApiKey,
            steamids: batch.join(','),
            format: 'json',
          },
        });

        const players = resp.data?.response?.players ?? [];
        for (const p of players) {
          results.push({
            steamId: String(p.steamid),
            personaName: String(p.personaname ?? ''),
            avatar: String(p.avatar ?? ''),
            avatarFull: String(p.avatarfull ?? ''),
            profileUrl: String(p.profileurl ?? ''),
            countryCode: p.loccountrycode ? String(p.loccountrycode) : undefined,
            personaState: p.personastate != null ? Number(p.personastate) : undefined,
            gameId: p.gameid != null ? String(p.gameid) : undefined,
            gameExtrainfo: p.gameextrainfo ? String(p.gameextrainfo) : undefined,
          });
        }
      } catch (e: any) {
        if (e?.code === 'ECONNABORTED') throw new ApiError(504, 'STEAM_API_TIMEOUT', 'Steam request timeout', e);
        throw new ApiError(502, 'INTERNAL_ERROR', 'Steam GetPlayerSummaries failed', e);
      }
    }

    return results;
  }

  async getFriendList(ownerSteamId: string): Promise<string[]> {
    const e = await getEffectiveEnv(this.env);
    if (!String(e.steamApiKey ?? '').trim()) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'STEAM_API_KEY is not configured (env or admin runtime settings)');
    }
    try {
      const resp = await axios.get(GET_FRIEND_LIST, {
        timeout: e.steamHttpTimeoutMs,
        params: {
          key: e.steamApiKey,
          steamid: ownerSteamId,
          relationship: 'friend',
          format: 'json',
        },
      });

      const data = resp.data;
      if (data?.error) {
        const msg = String(data.error);
        if (msg.toLowerCase().includes('private')) {
          throw new ApiError(403, 'STEAM_FRIENDS_PRIVATE', 'Steam friend list is private', data);
        }
        throw new ApiError(502, 'INTERNAL_ERROR', msg, data);
      }

      const friends = data?.friendslist?.friends ?? [];
      const attrs = data?.friendslist?.['@attributes'] ?? {};
      const permission = String(attrs.permission ?? attrs.privacy ?? '');
      if (permission.toLowerCase().includes('private')) {
        throw new ApiError(403, 'STEAM_FRIENDS_PRIVATE', 'Steam friend list is private', data);
      }

      return friends.map((f: any) => String(f.steamid)).filter(Boolean);
    } catch (e: any) {
      if (e instanceof ApiError) throw e;
      if (e?.code === 'ECONNABORTED') throw new ApiError(504, 'STEAM_API_TIMEOUT', 'Steam request timeout', e);
      // When permissions are not granted Steam sometimes returns an error payload without proper shape.
      const msg = String(e?.response?.data?.error ?? e?.message ?? 'Steam GetFriendList failed');
      if (msg.toLowerCase().includes('private')) {
        throw new ApiError(403, 'STEAM_FRIENDS_PRIVATE', 'Steam friend list is private', msg);
      }
      throw new ApiError(502, 'INTERNAL_ERROR', 'Steam GetFriendList failed', e);
    }
  }

  async getOwnedGames(ownerSteamId: string): Promise<{ games: SteamGame[]; gameCount: number }> {
    const e = await getEffectiveEnv(this.env);
    if (!String(e.steamApiKey ?? '').trim()) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'STEAM_API_KEY is not configured (env or admin runtime settings)');
    }
    try {
      const resp = await axios.get(GET_OWNED_GAMES, {
        timeout: e.steamHttpTimeoutMs,
        params: {
          key: e.steamApiKey,
          steamid: ownerSteamId,
          include_appinfo: 1,
          include_played_free_games: 1,
          format: 'json',
        },
      });

      const data = resp.data?.response;
      if (!data) throw new ApiError(502, 'INTERNAL_ERROR', 'Invalid Steam GetOwnedGames response', resp.data);

      const error = resp.data?.error;
      if (error) {
        throw new ApiError(403, 'STEAM_OWNED_UNAVAILABLE', 'Steam owned games are not available', error);
      }

      const ownedGames = data.games ?? [];
      const gameCount = Number(data.game_count ?? ownedGames.length ?? 0);

      const games: SteamGame[] = ownedGames.map((g: any) => {
        const appid = String(g.appid);
        const name = String(g.name ?? '');
        const headerImage = g.img_logo_url
          ? String(g.img_logo_url)
          : g.img_icon_url
            ? String(g.img_icon_url)
            : undefined;
        const pt = g.playtime_forever;
        const playtimeForever = pt != null && pt !== '' ? Number(pt) : undefined;
        return {
          appid,
          name,
          headerImage,
          source: 'owned' as const,
          ...(Number.isFinite(playtimeForever) ? { playtimeForever } : {}),
        };
      });

      return { games, gameCount };
    } catch (e: any) {
      if (e instanceof ApiError) {
        if (e.code === 'STEAM_OWNED_UNAVAILABLE') throw e;
      }
      if (e?.code === 'ECONNABORTED') throw new ApiError(504, 'STEAM_API_TIMEOUT', 'Steam request timeout', e);
      const msg = String(e?.response?.data?.error ?? e?.message ?? '');
      if (msg.toLowerCase().includes('private') || msg.toLowerCase().includes('unavailable')) {
        throw new ApiError(403, 'STEAM_OWNED_UNAVAILABLE', 'Steam owned games are not visible', msg);
      }
      throw new ApiError(502, 'INTERNAL_ERROR', 'Steam GetOwnedGames failed', e);
    }
  }

  async getRecentlyPlayedGames(ownerSteamId: string, count = 30): Promise<{ games: SteamGame[]; totalCount: number }> {
    const e = await getEffectiveEnv(this.env);
    if (!String(e.steamApiKey ?? '').trim()) {
      throw new ApiError(500, 'INTERNAL_ERROR', 'STEAM_API_KEY is not configured (env or admin runtime settings)');
    }
    try {
      const resp = await axios.get(GET_RECENTLY_PLAYED, {
        timeout: e.steamHttpTimeoutMs,
        params: {
          key: e.steamApiKey,
          steamid: ownerSteamId,
          count,
          include_played_free_games: 1,
          format: 'json',
        },
      });

      const data = resp.data?.response;
      if (!data) throw new ApiError(502, 'INTERNAL_ERROR', 'Invalid Steam GetRecentlyPlayedGames response', resp.data);
      const error = resp.data?.error;
      if (error) {
        throw new ApiError(403, 'STEAM_OWNED_UNAVAILABLE', 'Steam recent games are not visible', error);
      }

      const totalCount = Number(data.total_count ?? data.games?.length ?? 0);
      const recentGames = data.games ?? [];

      const games: SteamGame[] = recentGames.map((g: any) => {
        const appid = String(g.appid);
        const name = String(g.name ?? '');
        const headerImage = g.img_logo_url
          ? String(g.img_logo_url)
          : g.img_icon_url
            ? String(g.img_icon_url)
            : undefined;
        return { appid, name, headerImage, source: 'recent' };
      });

      return { games, totalCount };
    } catch (e: any) {
      if (e instanceof ApiError) throw e;
      if (e?.code === 'ECONNABORTED') throw new ApiError(504, 'STEAM_API_TIMEOUT', 'Steam request timeout', e);
      const msg = String(e?.response?.data?.error ?? e?.message ?? '');
      if (msg.toLowerCase().includes('private') || msg.toLowerCase().includes('unavailable')) {
        throw new ApiError(403, 'STEAM_OWNED_UNAVAILABLE', 'Steam recent games are not visible', msg);
      }
      throw new ApiError(502, 'INTERNAL_ERROR', 'Steam GetRecentlyPlayedGames failed', e);
    }
  }

  async getFriendsStatusCached(ownerSteamId: string, force = false): Promise<SteamFriendStatus[]> {
    if (!force) {
      const cached = await this.steamRepo.getFriendsCache(ownerSteamId);
      if (cached && this.isFresh(cached.lastFetchedAt, this.FRIENDS_TTL_MS)) {
        return cached.friends ?? [];
      }
    }

    const friendSteamIds = await this.getFriendList(ownerSteamId);
    const summaries = await this.getPlayerSummaries(friendSteamIds);
    const status: SteamFriendStatus[] = summaries.map((p) => {
      const st = this.mapPersonaState(p.personaState ?? 0);
      return {
        steamId: p.steamId,
        personaName: p.personaName,
        avatar: p.avatar,
        profileUrl: p.profileUrl,
        personaState: st.state,
        personaLabel: st.label,
        gameId: p.gameId,
        gameExtrainfo: p.gameExtrainfo,
      };
    });

    await this.steamRepo.setFriendsCache(ownerSteamId, status);
    return status;
  }

  async getOwnedGamesCached(ownerSteamId: string, force = false): Promise<{ games: SteamGame[]; gameCount: number }> {
    if (!force) {
      const cached = await this.steamRepo.getOwnedGamesCache(ownerSteamId);
      if (cached && this.isFresh(cached.lastFetchedAt, this.OWNED_TTL_MS)) {
        return { games: cached.games ?? [], gameCount: cached.gameCount ?? (cached.games ?? []).length };
      }
    }

    const fetched = await this.getOwnedGames(ownerSteamId);
    await this.steamRepo.setOwnedGamesCache(ownerSteamId, fetched.games, fetched.gameCount);
    return fetched;
  }

  async getRecentGamesCached(ownerSteamId: string, force = false): Promise<{ games: SteamGame[]; totalCount: number }> {
    if (!force) {
      const cached = await this.steamRepo.getRecentGamesCache(ownerSteamId);
      if (cached && this.isFresh(cached.lastFetchedAt, this.RECENT_TTL_MS)) {
        return { games: cached.games ?? [], totalCount: cached.totalCount ?? (cached.games ?? []).length };
      }
    }

    const fetched = await this.getRecentlyPlayedGames(ownerSteamId);
    await this.steamRepo.setRecentGamesCache(ownerSteamId, fetched.games, fetched.totalCount);
    return fetched;
  }

  async forceSyncAll(ownerSteamId: string) {
    const [friends, owned, recent] = await Promise.all([
      this.getFriendsStatusCached(ownerSteamId, true),
      this.getOwnedGamesCached(ownerSteamId, true),
      this.getRecentGamesCached(ownerSteamId, true),
    ]);

    return {
      friendsCount: friends.length,
      ownedGameCount: owned.gameCount,
      recentTotalCount: recent.totalCount,
    };
  }
}

