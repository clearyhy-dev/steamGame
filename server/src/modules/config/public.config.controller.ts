import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { getEffectiveEnv } from '../../config/runtime-config';
import { AdminSettingsRepository } from '../admin/admin.settings.repository';

/** Mobile/web clients: safe subset (no secrets). Cached indirectly via getEffectiveEnv (~60s server-side). */
function pickCountryHeader(headers: Record<string, unknown>): string | null {
  const pick = (v: unknown): string => {
    if (typeof v !== 'string' || !v.trim()) return '';
    return v.trim();
  };
  const raw =
    pick(headers['cloudfront-viewer-country']) ||
    pick(headers['cf-ipcountry']) ||
    pick(headers['x-appengine-country']) ||
    pick(headers['x-vercel-ip-country']);
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase();
  return null;
}

export class PublicConfigController {
  private settings = new AdminSettingsRepository();

  constructor(private env: Env) {}

  /** CDN / 平台可能注入国别请求头（无头则 null）；不做 GeoIP DB 推断。 */
  getClientRegion = async (req: Request, res: Response): Promise<void> => {
    const countryCode = pickCountryHeader(req.headers as Record<string, unknown>);
    res.status(200).json({ success: true, data: { countryCode } });
  };

  getClientConfig = async (_req: Request, res: Response): Promise<void> => {
    const e = await getEffectiveEnv(this.env);
    const runtime = await this.settings.getRuntime();
    const discount = await this.settings.getDiscountProviders();
    const root = String(e.appBaseUrl ?? '').trim().replace(/\/+$/, '');
    res.status(200).json({
      success: true,
      data: {
        appBaseUrl: e.appBaseUrl,
        appSwaggerUiUrl: root ? `${root}/api/docs` : '',
        appOpenApiJsonUrl: root ? `${root}/api/openapi.json` : '',
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
