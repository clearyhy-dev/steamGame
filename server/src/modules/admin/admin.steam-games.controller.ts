import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { sendAdminOk } from '../../utils/adminJson';
import { SteamRepository } from '../steam/steam.repository';
import type { SteamGame } from '../steam/steam.types';
import { SteamService } from '../steam/steam.service';

type GameRow = {
  ownerSteamId: string;
  source: 'owned' | 'recent';
  appid: string;
  name: string;
  headerImage?: string;
  playtimeForever?: number;
  lastFetchedAt: string | null;
};

function toIso(ts: any): string | null {
  if (!ts) return null;
  try {
    if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
    if (ts instanceof Date) return ts.toISOString();
    if (typeof ts === 'string') return ts;
  } catch (_) {}
  return null;
}

function normalizeText(v: unknown): string {
  return String(v ?? '').trim().toLowerCase();
}

export class AdminSteamGamesController {
  constructor(
    private env: Env,
    private repo = new SteamRepository(),
  ) {
    this.steamSvc = new SteamService(env);
  }
  private steamSvc: SteamService;

  list = async (req: Request, res: Response): Promise<void> => {
    const source = String(req.query.source ?? 'all') as 'all' | 'owned' | 'recent';
    const steamId = String(req.query.steamId ?? '').trim();
    const appid = String(req.query.appid ?? '').trim();
    const keyword = normalizeText(req.query.keyword);
    const ownerLimit = Math.max(1, Math.min(Number(req.query.ownerLimit ?? 80), 300));
    const rowLimit = Math.max(1, Math.min(Number(req.query.rowLimit ?? 2000), 5000));

    const rows: GameRow[] = [];

    const pushRows = (ownerSteamId: string, gameSource: 'owned' | 'recent', games: SteamGame[], lastFetchedAt: any) => {
      for (const g of games) {
        rows.push({
          ownerSteamId,
          source: gameSource,
          appid: String(g.appid ?? ''),
          name: String(g.name ?? ''),
          headerImage: g.headerImage,
          playtimeForever: g.playtimeForever,
          lastFetchedAt: toIso(lastFetchedAt),
        });
      }
    };

    if (source === 'all' || source === 'owned') {
      if (steamId) {
        const doc = await this.repo.getOwnedGamesCache(steamId);
        if (doc) pushRows(doc.ownerSteamId, 'owned', doc.games ?? [], doc.lastFetchedAt);
      } else {
        const docs = await this.repo.listOwnedGamesCaches(ownerLimit);
        for (const doc of docs) {
          pushRows(doc.ownerSteamId, 'owned', doc.games ?? [], doc.lastFetchedAt);
        }
      }
    }

    if (source === 'all' || source === 'recent') {
      if (steamId) {
        const doc = await this.repo.getRecentGamesCache(steamId);
        if (doc) pushRows(doc.ownerSteamId, 'recent', doc.games ?? [], doc.lastFetchedAt);
      } else {
        const docs = await this.repo.listRecentGamesCaches(ownerLimit);
        for (const doc of docs) {
          pushRows(doc.ownerSteamId, 'recent', doc.games ?? [], doc.lastFetchedAt);
        }
      }
    }

    let filtered = rows;
    if (appid) filtered = filtered.filter((r) => r.appid === appid);
    if (keyword) filtered = filtered.filter((r) => normalizeText(r.name).includes(keyword));

    filtered.sort((a, b) => {
      const ta = a.lastFetchedAt ? Date.parse(a.lastFetchedAt) : 0;
      const tb = b.lastFetchedAt ? Date.parse(b.lastFetchedAt) : 0;
      return tb - ta;
    });

    const capped = filtered.slice(0, rowLimit);
    sendAdminOk(res, {
      total: filtered.length,
      rows: capped,
    });
  };

  syncOne = async (req: Request, res: Response): Promise<void> => {
    const steamId = String(req.params.steamId ?? '').trim();
    if (!steamId) {
      sendAdminOk(res, { synced: false, message: 'steamId required' });
      return;
    }
    const out = await this.steamSvc.forceSyncAll(steamId);
    sendAdminOk(res, { synced: true, steamId, ...out });
  };
}

