import type { Request, Response } from 'express';
import { AdminSettingsRepository } from '../admin/admin.settings.repository';
import { RegionCountryRepository } from './region-country.repository';
import { defaultCurrencySymbol } from './currency-symbol.util';

/** GET /api/v1/config/countries — enabled countries only, sorted, no secrets. */
export class PublicRegionCountriesController {
  private settings = new AdminSettingsRepository();
  private countries = new RegionCountryRepository();

  getCountries = async (_req: Request, res: Response): Promise<void> => {
    const rs = await this.settings.getRegionSettings();
    const rows = await this.countries.listEnabledPublic();
    const dc = String(rs.defaultCountry ?? 'US')
      .trim()
      .toUpperCase();
    const fb = String(rs.fallbackCountry ?? 'US')
      .trim()
      .toUpperCase();
    res.status(200).json({
      success: true,
      data: {
        defaultCountry: dc || 'US',
        fallbackCountry: fb || 'US',
        countries: rows.map((r) => ({
          countryCode: r.countryCode,
          countryName: r.countryName,
          nativeName: r.nativeName ? String(r.nativeName) : undefined,
          steamCc: r.steamCc,
          steamLanguage: r.steamLanguage,
          defaultCurrency: r.defaultCurrency,
          currencySymbol: r.currencySymbol || defaultCurrencySymbol(r.defaultCurrency),
          enabled: true,
        })),
      },
    });
  };
}
