import type { Request, Response } from 'express';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import { RegionCountryRepository } from '../config/region-country.repository';
import { defaultCurrencySymbol } from '../config/currency-symbol.util';

export class AdminRegionCountriesController {
  private repo = new RegionCountryRepository();

  list = async (_req: Request, res: Response): Promise<void> => {
    const rows = await this.repo.listAllForAdmin();
    sendAdminOk(res, rows.map((r) => ({
      ...r,
      currencySymbol: r.currencySymbol || defaultCurrencySymbol(r.defaultCurrency),
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
      sendAdminOk(res, {
        ...row,
        currencySymbol: row.currencySymbol || defaultCurrencySymbol(row.defaultCurrency),
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
    sendAdminOk(res, { countryCode: code, enabled });
  };
}
