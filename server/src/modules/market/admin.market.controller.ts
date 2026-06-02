import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import { useSqliteRelationalStore } from '../../config/database';
import {
  sqliteListMarketGames,
  sqliteGetMarketGame,
  sqliteCountMarketGamesForCountry,
} from '../../storage/sqlite/market-games.store';
import {
  readMarketJson,
  marketGameDetailPath,
  marketGameHeatPath,
  marketGamePricesPath,
} from '../../cache/market-object-storage';
import { MarketSyncService } from '../market/market-sync.service';
import {
  runMarketCountryRoundRobin,
  getMarketRoundRobinStatus,
} from '../market/market-round-robin.runner';
import type { MarketDetailDoc, MarketHeatDoc, MarketPricesDoc } from '../market/market.types';
import { RegionCountryRepository } from '../config/region-country.repository';
import { buildMarketGamePriceSummary } from '../market/market-price-summary.util';
import { jsonPlain } from '../../utils/json-plain';

function normCc(raw: unknown): string | null {
  const cc = String(raw ?? '').trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

export class AdminMarketController {
  private sync: MarketSyncService;
  private regionCountries = new RegionCountryRepository();

  constructor(private env: Env) {
    this.sync = new MarketSyncService(env);
  }

  listGames = async (req: Request, res: Response): Promise<void> => {
    if (!useSqliteRelationalStore()) {
      sendAdminFail(res, 503, 'market v2 需要 DATA_STORE=vultr_sqlite');
      return;
    }
    const cc = normCc(req.params.cc);
    if (!cc) {
      sendAdminFail(res, 400, 'invalid country code');
      return;
    }
    const page = Math.max(1, Math.trunc(Number(req.query.page ?? 1)));
    const pageSize = Math.max(1, Math.min(Math.trunc(Number(req.query.pageSize ?? 50)), 200));
    const sortRaw = String(req.query.sortBy ?? 'online_desc');
    const sortBy =
      sortRaw === 'heat_desc' || sortRaw === 'discount_desc' ? sortRaw : ('online_desc' as const);
    const { rows, total } = await sqliteListMarketGames({ countryCode: cc, page, pageSize, sortBy });
    const resolved = await this.regionCountries.resolveForRegionalDetail(cc);
    const normalizedRows = rows.map((r) => ({
      ...r,
      currency: resolved.defaultCurrency,
      currencySymbol: resolved.currencySymbol,
    }));
    sendAdminOk(res, {
      countryCode: cc,
      currency: resolved.defaultCurrency,
      currencySymbol: resolved.currencySymbol,
      page,
      pageSize,
      total,
      rows: normalizedRows,
    });
  };

  getGame = async (req: Request, res: Response): Promise<void> => {
    const cc = normCc(req.params.cc);
    const appid = String(req.params.appid ?? '').trim();
    if (!cc || !appid) {
      sendAdminFail(res, 400, 'invalid country or appid');
      return;
    }
    const index = await sqliteGetMarketGame(cc, appid);
    const resolved = await this.regionCountries.resolveForRegionalDetail(cc);
    const [detail, heat, prices] = await Promise.all([
      readMarketJson<MarketDetailDoc>(this.env, marketGameDetailPath(cc, appid)),
      readMarketJson<MarketHeatDoc>(this.env, marketGameHeatPath(cc, appid)),
      readMarketJson<MarketPricesDoc>(this.env, marketGamePricesPath(cc, appid)),
    ]);
    const priceSummary =
      index?.priceSummary ??
      buildMarketGamePriceSummary({
        countryCode: cc,
        appid,
        resolved,
        bucket: prices?.bucket ?? null,
        detail: detail ?? null,
      });
    const normalizedIndex = index
      ? { ...index, currency: resolved.defaultCurrency, currencySymbol: resolved.currencySymbol, priceSummary }
      : null;
    sendAdminOk(res, {
      index: normalizedIndex,
      detail,
      heat,
      prices: prices
        ? {
            ...prices,
            bucket: prices.bucket ? jsonPlain(prices.bucket) : null,
          }
        : null,
      priceSummary,
    });
  };

  syncStatus = async (_req: Request, res: Response): Promise<void> => {
    const state = await getMarketRoundRobinStatus();
    sendAdminOk(res, { state });
  };

  syncOne = async (req: Request, res: Response): Promise<void> => {
    const cc = normCc(req.params.cc);
    const appid = String(req.params.appid ?? '').trim();
    if (!cc || !appid) {
      sendAdminFail(res, 400, 'invalid country or appid');
      return;
    }
    const force = req.body?.forceRefresh === true;
    const result = await this.sync.syncGameMarket(cc, appid, {
      forceRefresh: force,
      skipIfSyncedToday: !force,
    });
    sendAdminOk(res, result);
  };

  runRoundRobin = async (req: Request, res: Response): Promise<void> => {
    const payload = (req.body?.payload ?? req.body ?? {}) as Record<string, unknown>;
    const result = await runMarketCountryRoundRobin(this.env, {
      batchSize: payload.batchSize != null ? Number(payload.batchSize) : undefined,
      topNPerCountry: payload.topNPerCountry != null ? Number(payload.topNPerCountry) : undefined,
      delayMs: payload.delayMs != null ? Number(payload.delayMs) : undefined,
      skipSyncedToday: payload.skipSyncedToday !== false,
      forceRefresh: payload.forceRefresh === true,
      includeDetail: payload.includeDetail === true,
      includeHeat: payload.includeHeat === true,
      includePrices: payload.includePrices !== false,
      concurrency: payload.concurrency != null ? Number(payload.concurrency) : undefined,
      platforms: Array.isArray(payload.platforms) ? (payload.platforms as string[]) : undefined,
      resetQueue: payload.resetQueue === true,
    });
    sendAdminOk(res, result);
  };

  countryStats = async (req: Request, res: Response): Promise<void> => {
    const cc = normCc(req.params.cc);
    if (!cc) {
      sendAdminFail(res, 400, 'invalid country code');
      return;
    }
    const count = await sqliteCountMarketGamesForCountry(cc);
    const resolved = await this.regionCountries.resolveForRegionalDetail(cc);
    sendAdminOk(res, {
      countryCode: cc,
      gameCount: count,
      currency: resolved.defaultCurrency,
      currencySymbol: resolved.currencySymbol,
    });
  };
}
