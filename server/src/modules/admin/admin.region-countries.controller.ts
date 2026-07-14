import type { Request, Response } from 'express';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import { PUBLIC_COUNTRIES_CACHE_KEY } from '../../cache/publicCacheKeys';
import { cacheService } from '../../cache/cacheService';
import { inferUiLanguage, RegionCountryRepository, type MarketSyncTier } from '../config/region-country.repository';
import { effectiveCurrencySymbol } from '../config/currency-symbol.util';
import {
  CHEAPSHARK_LIST_COUNTRY,
  ggDealsRegionSuggestOptions,
} from '../config/deal-provider-region.catalog';
import { listExternalDealApiDocs } from '../config/external-deal-api.catalog';
import { MarketSyncTierRepository } from '../config/market-sync-tier.repository';
import { normalizeMarketSyncTier } from '../config/market-sync-tier.config';
import { loadRegionCountriesForMarketSync } from '../config/market-sync-tier.service';

export class AdminRegionCountriesController {
  private repo = new RegionCountryRepository();
  private tierRepo = new MarketSyncTierRepository();

  /** GG 下拉建议、CheapShark 固定国别说明（与 `deal-provider-region.catalog` 同源） */
  providerMeta = async (_req: Request, res: Response): Promise<void> => {
    sendAdminOk(res, {
      ggDealsSuggestedRegions: ggDealsRegionSuggestOptions(),
      cheapsharkListCountry: CHEAPSHARK_LIST_COUNTRY,
      cheapsharkNote:
        'CheapShark 列表接口的 country 不改变返回的 deal；请固定 US，各国折扣请以 ITAD / GG.deals 为准。',
      externalDealApis: listExternalDealApiDocs(),
    });
  };

  list = async (_req: Request, res: Response): Promise<void> => {
    await this.repo.backfillDefaultSyncTiers(false);
    const rows = await this.repo.listAllForAdmin();
    sendAdminOk(res, rows.map((r) => ({
      ...r,
      syncTier: normalizeMarketSyncTier(r.syncTier),
      currencySymbol: effectiveCurrencySymbol(r.defaultCurrency, r.currencySymbol),
      uiLanguage: inferUiLanguage(r),
      createdAt: r.createdAt?.toDate?.()?.toISOString?.() ?? null,
      updatedAt: r.updatedAt?.toDate?.()?.toISOString?.() ?? null,
    })));
  };

  upsert = async (req: Request, res: Response): Promise<void> => {
    try {
      const steamLang = String(req.body?.steamLanguage ?? 'en').trim().toLowerCase();
      if (!/^[a-z]{2}(-[a-z]{2})?$/.test(steamLang) && !/^[a-z]{3,}$/.test(steamLang)) {
        sendAdminFail(res, 400, 'steamLanguage: use ISO 639-1 (e.g. en, ja) or a Steam language token (e.g. schinese)');
        return;
      }
      const row = await this.repo.upsert(req.body);
      await cacheService.invalidateCache(PUBLIC_COUNTRIES_CACHE_KEY);
      sendAdminOk(res, {
        ...row,
        currencySymbol: effectiveCurrencySymbol(row.defaultCurrency, row.currencySymbol),
        uiLanguage: inferUiLanguage(row),
        createdAt: row.createdAt?.toDate?.()?.toISOString?.() ?? null,
        updatedAt: row.updatedAt?.toDate?.()?.toISOString?.() ?? null,
      });
    } catch (e) {
      sendAdminFail(res, 400, e instanceof Error ? e.message : 'invalid body');
    }
  };

  patchEnabled = async (req: Request, res: Response): Promise<void> => {
    const code = String(req.params.countryCode ?? '').trim().toUpperCase();
    const enabled = Boolean(req.body?.enabled);
    if (!/^[A-Z]{2}$/.test(code)) {
      sendAdminFail(res, 400, 'countryCode must be 2 letters');
      return;
    }
    await this.repo.setEnabled(code, enabled);
    await cacheService.invalidateCache(PUBLIC_COUNTRIES_CACHE_KEY);
    sendAdminOk(res, { countryCode: code, enabled });
  };

  getSyncTierSettings = async (_req: Request, res: Response): Promise<void> => {
    const settings = await this.tierRepo.getSettings();
    const plan = await loadRegionCountriesForMarketSync();
    sendAdminOk(res, {
      settings,
      todaySyncCountries: plan.countries.length,
      t1Count: plan.countries.filter((c) => c.syncTier === 'T1').length,
      t2Count: plan.countries.filter((c) => c.syncTier === 'T2').length,
    });
  };

  saveSyncTierSettings = async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body ?? {};
      const settings = await this.tierRepo.saveSettings({
        t1TopNPerCountry: body.t1TopNPerCountry != null ? Number(body.t1TopNPerCountry) : undefined,
        t2TopNPerCountry: body.t2TopNPerCountry != null ? Number(body.t2TopNPerCountry) : undefined,
        t2SyncIntervalDays: body.t2SyncIntervalDays != null ? Number(body.t2SyncIntervalDays) : undefined,
      });
      sendAdminOk(res, { settings });
    } catch (e) {
      sendAdminFail(res, 400, e instanceof Error ? e.message : 'invalid settings');
    }
  };

  patchSyncTier = async (req: Request, res: Response): Promise<void> => {
    const code = String(req.params.countryCode ?? '').trim().toUpperCase();
    const tier = normalizeMarketSyncTier(req.body?.syncTier) as MarketSyncTier;
    if (!/^[A-Z]{2}$/.test(code)) {
      sendAdminFail(res, 400, 'countryCode must be 2 letters');
      return;
    }
    await this.repo.setSyncTier(code, tier);
    await cacheService.invalidateCache(PUBLIC_COUNTRIES_CACHE_KEY);
    sendAdminOk(res, { countryCode: code, syncTier: tier });
  };

  /** POST body `{ force?: boolean }` — 按默认 T1 列表重置各国层级（force 覆盖手动配置） */
  resetSyncTiersToDefault = async (req: Request, res: Response): Promise<void> => {
    const force = Boolean(req.body?.force);
    const { updated } = await this.repo.backfillDefaultSyncTiers(force);
    await cacheService.invalidateCache(PUBLIC_COUNTRIES_CACHE_KEY);
    sendAdminOk(res, { updated, force });
  };

  /** POST body: `{ force?: boolean }` — 按 Steam cc 规则写入 ITAD/GG/CS（GG 含 eu；CS 固定 US） */
  syncProviderCodesFromSteam = async (req: Request, res: Response): Promise<void> => {
    const force = Boolean(req.body?.force);
    const { updated } = await this.repo.backfillDealProviderCodesFromSteamCc(force);
    const sym = await this.repo.backfillCurrencySymbols(force);
    await cacheService.invalidateCache(PUBLIC_COUNTRIES_CACHE_KEY);
    sendAdminOk(res, { updated, currencySymbolsUpdated: sym.updated, force });
  };
}
