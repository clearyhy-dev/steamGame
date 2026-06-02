import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { getEffectiveEnv, invalidateRuntimeConfigCache } from '../../config/runtime-config';
import { sendAdminOk } from '../../utils/adminJson';
import { listExternalDealApiDocs } from '../config/external-deal-api.catalog';
import { AdminSettingsRepository } from './admin.settings.repository';

function serializeDiscount(cfg: Awaited<ReturnType<AdminSettingsRepository['getDiscountProviders']>>) {
  return {
    ...cfg,
    updatedAt: cfg.updatedAt.toDate().toISOString(),
    createdAt: cfg.createdAt.toDate().toISOString(),
  };
}

function resolveDocUrls(appBaseUrl: string, stored: Partial<{ appSwaggerUiUrl?: string; appOpenApiJsonUrl?: string }>) {
  const root = String(appBaseUrl ?? '').trim().replace(/\/+$/, '');
  const swaggerOverride = String(stored.appSwaggerUiUrl ?? '').trim();
  const openApiOverride = String(stored.appOpenApiJsonUrl ?? '').trim();
  return {
    appSwaggerUiUrl: swaggerOverride || (root ? `${root}/api/docs` : ''),
    appOpenApiJsonUrl: openApiOverride || (root ? `${root}/api/openapi.json` : ''),
  };
}

function serializeRuntimeEffective(e: Env) {
  return {
    adminUsername: e.adminUsername,
    adminPassword: '',
    adminPasswordSet: !!e.adminPassword,
    steamApiKey: e.steamApiKey,
    steamOpenidRealm: e.steamOpenidRealm,
    steamOpenidReturnUrl: e.steamOpenidReturnUrl,
    appDeeplinkScheme: e.appDeeplinkScheme,
    appDeeplinkSuccessHost: e.appDeeplinkSuccessHost,
    appDeeplinkFailHost: e.appDeeplinkFailHost,
    appBaseUrl: e.appBaseUrl,
    steamHttpTimeoutMs: e.steamHttpTimeoutMs,
    steamAutoSyncEnabled: e.steamAutoSyncEnabled,
    steamAutoSyncIntervalMs: e.steamAutoSyncIntervalMs,
    steamAutoSyncBatchSize: e.steamAutoSyncBatchSize,
    steamAutoSyncDelayMs: e.steamAutoSyncDelayMs,
    requestLogRetentionDays: e.requestLogRetentionDays,
    videoGcsBucket: e.videoGcsBucket ?? '',
    ffmpegPath: e.ffmpegPath,
    ffprobePath: e.ffprobePath,
    ytDlpPath: e.ytDlpPath,
    videoTempDir: e.videoTempDir,
    videoMaxDurationSec: e.videoMaxDurationSec,
    videoTrimSec: e.videoTrimSec,
    videoSignedUrlMinutes: e.videoSignedUrlMinutes,
    videoWorkerIntervalMs: e.videoWorkerIntervalMs,
    appConnectTimeoutSec: e.appConnectTimeoutSec,
    appReceiveTimeoutSec: e.appReceiveTimeoutSec,
  };
}

export class AdminSettingsController {
  constructor(
    private env: Env,
    private repo = new AdminSettingsRepository(),
  ) {}

  getDiscountProviders = async (_req: Request, res: Response): Promise<void> => {
    const cfg = await this.repo.getDiscountProviders();
    sendAdminOk(res, { ...serializeDiscount(cfg), externalDealApis: listExternalDealApiDocs() });
  };

  patchDiscountProviders = async (req: Request, res: Response): Promise<void> => {
    const body = req.body ?? {};
    const patch: Record<string, string> = {};
    if (typeof body.itadApiKey === 'string') patch.itadApiKey = body.itadApiKey.trim();
    if (typeof body.ggDealsApiKey === 'string') patch.ggDealsApiKey = body.ggDealsApiKey.trim();
    if (typeof body.steamApiKey === 'string') patch.steamApiKey = body.steamApiKey.trim();
    if (typeof body.itadBaseUrl === 'string') patch.itadBaseUrl = body.itadBaseUrl.trim();
    if (typeof body.ggDealsBaseUrl === 'string') patch.ggDealsBaseUrl = body.ggDealsBaseUrl.trim();
    if (typeof body.cheapSharkBaseUrl === 'string') patch.cheapSharkBaseUrl = body.cheapSharkBaseUrl.trim();
    if (typeof body.steamWebApiBaseUrl === 'string') patch.steamWebApiBaseUrl = body.steamWebApiBaseUrl.trim();
    if (typeof body.steamStoreBaseUrl === 'string') patch.steamStoreBaseUrl = body.steamStoreBaseUrl.trim();
    const cfg = await this.repo.patchDiscountProviders(patch);
    sendAdminOk(res, { ...serializeDiscount(cfg), externalDealApis: listExternalDealApiDocs() });
  };

  getRuntime = async (_req: Request, res: Response): Promise<void> => {
    const effective = await getEffectiveEnv(this.env);
    const stored = await this.repo.getRuntime();
    sendAdminOk(res, {
      effective: serializeRuntimeEffective(effective),
      resolved: resolveDocUrls(effective.appBaseUrl, stored),
      stored,
    });
  };

  patchRuntime = async (req: Request, res: Response): Promise<void> => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    const strKeys = [
      'adminUsername',
      'steamApiKey',
      'steamOpenidRealm',
      'steamOpenidReturnUrl',
      'appDeeplinkScheme',
      'appDeeplinkSuccessHost',
      'appDeeplinkFailHost',
      'appBaseUrl',
      'appSwaggerUiUrl',
      'appOpenApiJsonUrl',
      'videoGcsBucket',
      'ffmpegPath',
      'ffprobePath',
      'ytDlpPath',
      'videoTempDir',
    ] as const;
    for (const k of strKeys) {
      if (typeof body[k] === 'string') patch[k] = body[k];
    }
    if (typeof body.adminPassword === 'string' && body.adminPassword.trim()) {
      patch.adminPassword = body.adminPassword.trim();
    }

    const numKeys = [
      'steamHttpTimeoutMs',
      'steamAutoSyncIntervalMs',
      'steamAutoSyncBatchSize',
      'steamAutoSyncDelayMs',
      'requestLogRetentionDays',
      'videoMaxDurationSec',
      'videoTrimSec',
      'videoSignedUrlMinutes',
      'videoWorkerIntervalMs',
      'appConnectTimeoutSec',
      'appReceiveTimeoutSec',
    ] as const;
    for (const k of numKeys) {
      if (body[k] !== undefined && body[k] !== null && body[k] !== '') {
        const n = Number(body[k]);
        if (Number.isFinite(n)) patch[k] = n;
      }
    }

    if (typeof body.steamAutoSyncEnabled === 'boolean') {
      patch.steamAutoSyncEnabled = body.steamAutoSyncEnabled;
    }

    await this.repo.patchRuntime(patch);
    invalidateRuntimeConfigCache();
    const effective = await getEffectiveEnv(this.env);
    const stored = await this.repo.getRuntime();
    sendAdminOk(res, {
      effective: serializeRuntimeEffective(effective),
      resolved: resolveDocUrls(effective.appBaseUrl, stored),
      stored,
    });
  };
}
