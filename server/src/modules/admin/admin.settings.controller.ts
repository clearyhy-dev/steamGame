import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { getEffectiveEnv, invalidateRuntimeConfigCache } from '../../config/runtime-config';
import { sendAdminOk } from '../../utils/adminJson';
import { AdminSettingsRepository } from './admin.settings.repository';

function serializeDiscount(cfg: Awaited<ReturnType<AdminSettingsRepository['getDiscountProviders']>>) {
  return {
    ...cfg,
    updatedAt: cfg.updatedAt.toDate().toISOString(),
    createdAt: cfg.createdAt.toDate().toISOString(),
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
    sendAdminOk(res, serializeDiscount(cfg));
  };

  patchDiscountProviders = async (req: Request, res: Response): Promise<void> => {
    const body = req.body ?? {};
    const patch: Record<string, string> = {};
    if (typeof body.itadApiKey === 'string') patch.itadApiKey = body.itadApiKey.trim();
    if (typeof body.ggDealsApiKey === 'string') patch.ggDealsApiKey = body.ggDealsApiKey.trim();
    if (typeof body.itadBaseUrl === 'string') patch.itadBaseUrl = body.itadBaseUrl.trim();
    if (typeof body.ggDealsBaseUrl === 'string') patch.ggDealsBaseUrl = body.ggDealsBaseUrl.trim();
    if (typeof body.cheapSharkBaseUrl === 'string') patch.cheapSharkBaseUrl = body.cheapSharkBaseUrl.trim();
    if (typeof body.dealCountriesCsv === 'string') patch.dealCountriesCsv = body.dealCountriesCsv.trim().toUpperCase();
    const cfg = await this.repo.patchDiscountProviders(patch);
    sendAdminOk(res, serializeDiscount(cfg));
  };

  getRuntime = async (_req: Request, res: Response): Promise<void> => {
    const effective = await getEffectiveEnv(this.env);
    const stored = await this.repo.getRuntime();
    sendAdminOk(res, {
      effective: serializeRuntimeEffective(effective),
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
      'appSupportedDealCountriesCsv',
      'appCountryMapJson',
      'appCountryCurrencyMapJson',
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
      stored,
    });
  };
}
