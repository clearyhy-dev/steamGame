import type { Request, Response } from 'express';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import { PUBLIC_COUNTRIES_CACHE_KEY } from '../../cache/publicCacheKeys';
import { cacheService } from '../../cache/cacheService';
import { inferUiLanguage, RegionCountryRepository } from '../config/region-country.repository';
import { effectiveCurrencySymbol } from '../config/currency-symbol.util';
import {
  CHEAPSHARK_LIST_COUNTRY,
  ggDealsRegionSuggestOptions,
} from '../config/deal-provider-region.catalog';
import { listExternalDealApiDocs } from '../config/external-deal-api.catalog';

export class AdminRegionCountriesController {
  private repo = new RegionCountryRepository();

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
    const rows = await this.repo.listAllForAdmin();
    sendAdminOk(res, rows.map((r) => ({
      ...r,
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

  /** POST body: `{ force?: boolean }` — 按 Steam cc 规则写入 ITAD/GG/CS（GG 含 eu；CS 固定 US） */
  syncProviderCodesFromSteam = async (req: Request, res: Response): Promise<void> => {
    const force = Boolean(req.body?.force);
    const { updated } = await this.repo.backfillDealProviderCodesFromSteamCc(force);
    const sym = await this.repo.backfillCurrencySymbols(force);
    await cacheService.invalidateCache(PUBLIC_COUNTRIES_CACHE_KEY);
    sendAdminOk(res, { updated, currencySymbolsUpdated: sym.updated, force });
  };
}
