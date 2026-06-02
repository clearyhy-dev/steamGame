import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { useSqliteRelationalStore } from '../../config/database';
import { sqliteListMarketGames, sqliteGetMarketGame } from '../../storage/sqlite/market-games.store';
import {
  readMarketJson,
  marketGameDetailPath,
  marketGameHeatPath,
  marketGamePricesPath,
  marketListPath,
} from '../../cache/market-object-storage';
import type { MarketDetailDoc, MarketHeatDoc, MarketPricesDoc } from './market.types';
import { MarketSyncService } from './market-sync.service';

function normCc(raw: unknown): string | null {
  const cc = String(raw ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

export class PublicMarketController {
  constructor(private env: Env) {}

  listGames = async (req: Request, res: Response): Promise<void> => {
    if (!useSqliteRelationalStore()) {
      res.status(503).json({ success: false, error: 'market v2 unavailable' });
      return;
    }
    const cc = normCc(req.params.cc);
    if (!cc) {
      res.status(400).json({ success: false, error: 'invalid country code' });
      return;
    }
    const page = Math.max(1, Math.trunc(Number(req.query.page ?? 1)));
    const pageSize = Math.max(1, Math.min(Math.trunc(Number(req.query.pageSize ?? 50)), 100));
    const sortRaw = String(req.query.sortBy ?? 'heat_desc');
    const sortBy =
      sortRaw === 'online_desc' || sortRaw === 'discount_desc' ? sortRaw : ('heat_desc' as const);
    const { rows, total } = await sqliteListMarketGames({ countryCode: cc, page, pageSize, sortBy });
    res.json({ success: true, countryCode: cc, page, pageSize, total, items: rows });
  };

  getGame = async (req: Request, res: Response): Promise<void> => {
    const cc = normCc(req.params.cc);
    const appid = String(req.params.appid ?? '').trim();
    if (!cc || !appid) {
      res.status(400).json({ success: false, error: 'invalid country or appid' });
      return;
    }
    const index = useSqliteRelationalStore() ? await sqliteGetMarketGame(cc, appid) : null;
    const [detail, heat, prices] = await Promise.all([
      readMarketJson<MarketDetailDoc>(this.env, marketGameDetailPath(cc, appid)),
      readMarketJson<MarketHeatDoc>(this.env, marketGameHeatPath(cc, appid)),
      readMarketJson<MarketPricesDoc>(this.env, marketGamePricesPath(cc, appid)),
    ]);
    if (!detail && !heat && !prices && !index) {
      res.status(404).json({ success: false, error: 'not_found' });
      return;
    }
    res.json({ success: true, countryCode: cc, appid, index, detail, heat, prices });
  };

  refreshGame = async (req: Request, res: Response): Promise<void> => {
    const cc = normCc(req.params.cc);
    const appid = String(req.params.appid ?? '').trim();
    if (!cc || !appid) {
      res.status(400).json({ success: false, error: 'invalid country or appid' });
      return;
    }
    const sync = new MarketSyncService(this.env);
    const result = await sync.syncGameMarket(cc, appid, {
      forceRefresh: true,
      skipIfSyncedToday: false,
    });
    res.json({ success: result.ok || result.detailOk, ...result });
  };

  getList = async (req: Request, res: Response): Promise<void> => {
    const cc = normCc(req.params.cc);
    const name = String(req.params.listName ?? '').trim();
    if (!cc || !name || !/^[a-z0-9-]+$/.test(name)) {
      res.status(400).json({ success: false, error: 'invalid path' });
      return;
    }
    const doc = await readMarketJson<unknown>(this.env, marketListPath(cc, name));
    if (!doc) {
      res.status(404).json({ success: false, error: 'not_found' });
      return;
    }
    res.json({ success: true, data: doc });
  };
}
