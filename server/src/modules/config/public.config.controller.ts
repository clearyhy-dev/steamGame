import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { getEffectiveEnv } from '../../config/runtime-config';
import { AdminSettingsRepository } from '../admin/admin.settings.repository';

/** Mobile/web clients: safe subset (no secrets). Cached indirectly via getEffectiveEnv (~60s server-side). */
export class PublicConfigController {
  private settings = new AdminSettingsRepository();

  constructor(private env: Env) {}

  getClientConfig = async (_req: Request, res: Response): Promise<void> => {
    const e = await getEffectiveEnv(this.env);
    const runtime = await this.settings.getRuntime();
    const discount = await this.settings.getDiscountProviders();
    res.status(200).json({
      success: true,
      data: {
        appBaseUrl: e.appBaseUrl,
        appDeeplinkScheme: e.appDeeplinkScheme,
        appDeeplinkSuccessHost: e.appDeeplinkSuccessHost,
        appDeeplinkFailHost: e.appDeeplinkFailHost,
        appConnectTimeoutSec: e.appConnectTimeoutSec,
        appReceiveTimeoutSec: e.appReceiveTimeoutSec,
        appSupportedDealCountriesCsv:
          String(runtime.appSupportedDealCountriesCsv ?? '').trim() || discount.dealCountriesCsv,
        appCountryMapJson: String(runtime.appCountryMapJson ?? '').trim(),
        appCountryCurrencyMapJson: String(runtime.appCountryCurrencyMapJson ?? '').trim(),
      },
    });
  };
}
