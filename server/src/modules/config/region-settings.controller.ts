import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { AdminSettingsRepository } from '../admin/admin.settings.repository';

export class RegionSettingsController {
  private settings = new AdminSettingsRepository();

  constructor(_env: Env) {}

  getRegionSettings = async (_req: Request, res: Response): Promise<void> => {
    const cfg = await this.settings.getRegionSettings();
    res.status(200).json({
      success: true,
      data: {
        enabledCountries: cfg.enabledCountries,
        defaultCountry: cfg.defaultCountry,
        fallbackCountry: cfg.fallbackCountry,
        countryCurrencyMap: cfg.countryCurrencyMap,
        countryLanguageMap: cfg.countryLanguageMap,
        priceSources: cfg.priceSources,
        cacheHours: cfg.cacheHours,
        showKeyshopDeals: cfg.showKeyshopDeals,
        showRegionWarning: cfg.showRegionWarning,
      },
    });
  };
}

