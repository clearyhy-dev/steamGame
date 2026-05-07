import type { Request, Response } from 'express';
import { inferUiLanguage, RegionCountryRepository } from './region-country.repository';
import { defaultCurrencySymbol } from './currency-symbol.util';

/** GET /api/v1/config/countries — enabled countries only, sorted, no secrets. */
export class PublicRegionCountriesController {
  private countries = new RegionCountryRepository();

  getCountries = async (_req: Request, res: Response): Promise<void> => {
    const rows = await this.countries.listEnabledPublic();
    const envDefault = String(process.env.DEFAULT_APP_COUNTRY ?? '')
      .trim()
      .toUpperCase();
    let defaultCountry = rows[0]?.countryCode ?? 'US';
    if (/^[A-Z]{2}$/.test(envDefault) && rows.some((r) => r.countryCode === envDefault)) {
      defaultCountry = envDefault;
    }
    const fallbackCountry = defaultCountry;

    res.status(200).json({
      success: true,
      data: {
        defaultCountry,
        fallbackCountry,
        countries: rows.map((r) => ({
          countryCode: r.countryCode,
          countryName: r.countryName,
          nativeName: r.nativeName ? String(r.nativeName) : undefined,
          steamCc: r.steamCc,
          steamLanguage: r.steamLanguage,
          uiLanguage: inferUiLanguage(r),
          defaultCurrency: r.defaultCurrency,
          currencySymbol: r.currencySymbol || defaultCurrencySymbol(r.defaultCurrency),
          enabled: true,
        })),
      },
    });
  };
}
