import type { Env } from '../../config/env';
import axios from 'axios';
import { SteamService } from '../steam/steam.service';
import { UsersRepository } from '../users/users.repository';
import type { ShareCardResponse, StatsSummaryResponse } from './stats.types';

async function steamStoreGenres(appid: string): Promise<string[]> {
  try {
    const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appid)}&l=english`;
    const { data } = await axios.get<
      Record<string, { success?: boolean; data?: { genres?: { description?: string }[] } }>
    >(url, { timeout: 5000 });
    const row = data[appid];
    if (!row?.success) return [];
    const genres = row.data?.genres;
    if (!Array.isArray(genres)) return [];
    return genres.map((g) => String(g?.description ?? '').trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function inferFavoriteGenres(topAppIds: string[], maxCalls: number): Promise<string[]> {
  const counts = new Map<string, number>();
  const ids = topAppIds.filter(Boolean).slice(0, maxCalls);
  await Promise.all(
    ids.map(async (id) => {
      const gs = await steamStoreGenres(id);
      for (const g of gs) counts.set(g, (counts.get(g) ?? 0) + 1);
    }),
  );
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.slice(0, 5).map(([g]) => g);
}

export class StatsService {
  private steam: SteamService;
  private users: UsersRepository;

  constructor(env: Env) {
    this.steam = new SteamService(env);
    this.users = new UsersRepository();
  }

  async summary(userId: string): Promise<StatsSummaryResponse> {
    const user = await this.users.findById(userId);
    const steamId = user?.steamId?.trim();
    if (!steamId) {
      return {
        steamLinked: false,
        ownedCount: 0,
        totalPlaytimeMinutes: 0,
        unplayedRatio: 0,
        recentGames: [],
        topPlayed: [],
        favoriteGenres: [],
      };
    }

    try {
      const [ownedR, recentR] = await Promise.all([
        this.steam.getOwnedGamesCached(steamId, false),
        this.steam.getRecentGamesCached(steamId, false),
      ]);
      const games = ownedR.games ?? [];
      let totalPt = 0;
      let unplayed = 0;
      for (const g of games) {
        const pt = g.playtimeForever ?? 0;
        totalPt += pt;
        if (pt <= 0) unplayed += 1;
      }
      const n = games.length || 1;
      const recentGames = (recentR.games ?? []).slice(0, 5).map((g) => ({ appid: g.appid, name: g.name }));
      const sorted = [...games].sort((a, b) => (b.playtimeForever ?? 0) - (a.playtimeForever ?? 0));
      const topPlayed = sorted.slice(0, 5).map((g) => ({
        appid: g.appid,
        name: g.name,
        playtimeMinutes: g.playtimeForever ?? 0,
      }));

      const topIds = topPlayed.map((t) => t.appid).filter(Boolean);
      const favoriteGenres = await inferFavoriteGenres(topIds, 6);

      return {
        steamLinked: true,
        ownedCount: ownedR.gameCount ?? games.length,
        totalPlaytimeMinutes: totalPt,
        unplayedRatio: Math.round((unplayed / n) * 1000) / 1000,
        recentGames,
        topPlayed,
        favoriteGenres,
      };
    } catch {
      return {
        steamLinked: true,
        ownedCount: 0,
        totalPlaytimeMinutes: 0,
        unplayedRatio: 0,
        recentGames: [],
        topPlayed: [],
        favoriteGenres: [],
      };
    }
  }

  async shareCard(userId: string): Promise<ShareCardResponse> {
    const s = await this.summary(userId);
    const hours = Math.round((s.totalPlaytimeMinutes / 60) * 10) / 10;
    const topName = s.topPlayed[0]?.name ?? 'Your library';
    return {
      title: 'Steam AI Deal Companion',
      subtitle: 'My Steam snapshot',
      stats: {
        totalGames: s.ownedCount,
        hoursPlayed: hours,
        favoriteGenre: s.favoriteGenres[0] ?? 'Mixed',
        collectionNote: s.unplayedRatio > 0.5 ? 'Lots of unplayed gems' : `${topName} leading your playtime`,
      },
    };
  }
}
