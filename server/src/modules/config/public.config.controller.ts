import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { getEffectiveEnv } from '../../config/runtime-config';
import { AdminSettingsRepository } from '../admin/admin.settings.repository';

export class PublicConfigController {
  private settings = new AdminSettingsRepository();

  constructor(private env: Env) {}

  /** 国家 CSV / 语言映射 / 货币映射见 `GET /api/v1/config/countries`，避免与结构化数据重复、漂移。 */
  getClientConfig = async (_req: Request, res: Response): Promise<void> => {
    const e = await getEffectiveEnv(this.env);
    const runtime = await this.settings.getRuntime();
    const root = String(e.appBaseUrl ?? '').trim().replace(/\/+$/, '');
    const swaggerOverride = String(runtime.appSwaggerUiUrl ?? '').trim();
    const openApiOverride = String(runtime.appOpenApiJsonUrl ?? '').trim();

    const cacheBase = String(e.publicCacheCdnBase ?? '').trim().replace(/\/+$/, '');

    res.status(200).json({
      success: true,
      data: {
        appBaseUrl: e.appBaseUrl,
        appSwaggerUiUrl: swaggerOverride || (root ? `${root}/api/docs` : ''),
        appOpenApiJsonUrl: openApiOverride || (root ? `${root}/api/openapi.json` : ''),
        appDeeplinkScheme: e.appDeeplinkScheme,
        appDeeplinkSuccessHost: e.appDeeplinkSuccessHost,
        appDeeplinkFailHost: e.appDeeplinkFailHost,
        appConnectTimeoutSec: e.appConnectTimeoutSec,
        appReceiveTimeoutSec: e.appReceiveTimeoutSec,
        ...(e.authServiceUrl ? { authServiceUrl: e.authServiceUrl } : {}),
        ...(cacheBase ? { publicCacheCdnBase: cacheBase } : {}),
      },
    });
  };
}
