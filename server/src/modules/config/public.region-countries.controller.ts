import type { Request, Response } from 'express';
import { pickCountryHeaderFromRequest } from './pick-request-country-header';
import { inferUiLanguage, RegionCountryRepository } from './region-country.repository';
import { defaultCurrencySymbol } from './currency-symbol.util';
import { CHEAPSHARK_LIST_COUNTRY, ggDealsRegionFromSteamCc } from './deal-provider-region.catalog';
import { CACHE_DEFAULT_TTL_SEC, cacheService } from '../../cache/cacheService';
import { PUBLIC_COUNTRIES_CACHE_KEY } from '../../cache/publicCacheKeys';

/** GET /api/v1/config/countries — enabled countries + header-based region guess（原 `/v1/config/client-region` 已并入）。 */
export class PublicRegionCountriesController {
  private countries = new RegionCountryRepository();

  getCountries = async (req: Request, res: Response): Promise<void> => {
    const cached = await cacheService.getCache<Record<string, unknown>>(PUBLIC_COUNTRIES_CACHE_KEY);
    if (cached) {
      res.status(200).json(cached);
      return;
    }

    const rows = await this.countries.listEnabledPublic();
    const envDefault = String(process.env.DEFAULT_APP_COUNTRY ?? '')
      .trim()
      .toUpperCase();
    let defaultCountry = rows[0]?.countryCode ?? 'US';
    if (/^[A-Z]{2}$/.test(envDefault) && rows.some((r) => r.countryCode === envDefault)) {
      defaultCountry = envDefault;
    }
    const fallbackCountry = defaultCountry;
    const clientRegionCountryCode = pickCountryHeaderFromRequest(req);

    const body = {
      success: true,
      data: {
        defaultCountry,
        fallbackCountry,
        /** 与旧 GET /v1/config/client-region 一致：边缘注入头推断，无头为 null */
        clientRegionCountryCode,
        countries: rows.map((r) => {
          const itad = String(r.itadCountry ?? '')
            .trim()
            .toUpperCase();
          const gg = String(r.ggDealsRegion ?? '')
            .trim()
            .toLowerCase();
          const cs = String(r.cheapsharkCountry ?? '')
            .trim()
            .toUpperCase();
          return {
            countryCode: r.countryCode,
            countryName: r.countryName,
            nativeName: r.nativeName ? String(r.nativeName) : undefined,
            steamCc: r.steamCc,
            steamLanguage: r.steamLanguage,
            uiLanguage: inferUiLanguage(r),
            defaultCurrency: r.defaultCurrency,
            currencySymbol: r.currencySymbol || defaultCurrencySymbol(r.defaultCurrency),
            /** 已解析：与 Admin 规则一致（GG 含 eu bucket；CS 固定 US） */
            itadCountry: /^[A-Z]{2}$/.test(itad) ? itad : r.countryCode,
            ggDealsRegion: /^[a-z]{2}$/.test(gg) ? gg : ggDealsRegionFromSteamCc(r.steamCc),
            cheapsharkCountry: /^[A-Z]{2}$/.test(cs) ? cs : CHEAPSHARK_LIST_COUNTRY,
            enabled: true,
          };
        }),
      },
    };
    await cacheService.setCache(PUBLIC_COUNTRIES_CACHE_KEY, body, CACHE_DEFAULT_TTL_SEC);
    res.status(200).json(body);
  };
}
