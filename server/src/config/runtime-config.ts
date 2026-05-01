import type { Env } from './env';
import type { RuntimeConfigDoc } from '../modules/admin/admin.settings.repository';
import { AdminSettingsRepository } from '../modules/admin/admin.settings.repository';

const TTL_MS = 60_000;

let cacheAt = 0;
let cached: Env | null = null;
let cachedBase: Env | null = null;

export function invalidateRuntimeConfigCache(): void {
  cacheAt = 0;
  cached = null;
  cachedBase = null;
}

function mergeEnv(base: Env, doc: Partial<RuntimeConfigDoc>): Env {
  const out: Env = { ...base };

  const str = (v: unknown): string | undefined => {
    if (v === undefined || v === null) return undefined;
    const s = String(v).trim();
    return s.length ? s : undefined;
  };
  const num = (v: unknown, fallback: number): number => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
    return fallback;
  };

  const au = str(doc.adminUsername);
  if (au !== undefined) out.adminUsername = au;

  const ap = str(doc.adminPassword);
  if (ap !== undefined) out.adminPassword = ap;

  const sk = str(doc.steamApiKey);
  if (sk !== undefined) out.steamApiKey = sk;

  const realm = str(doc.steamOpenidRealm);
  if (realm !== undefined) out.steamOpenidRealm = realm;

  const ret = str(doc.steamOpenidReturnUrl);
  if (ret !== undefined) out.steamOpenidReturnUrl = ret;

  const ds = str(doc.appDeeplinkScheme);
  if (ds !== undefined) out.appDeeplinkScheme = ds;

  const sh = str(doc.appDeeplinkSuccessHost);
  if (sh !== undefined) out.appDeeplinkSuccessHost = sh;

  const fh = str(doc.appDeeplinkFailHost);
  if (fh !== undefined) out.appDeeplinkFailHost = fh;

  const bu = str(doc.appBaseUrl);
  if (bu !== undefined) out.appBaseUrl = bu;

  if (doc.steamHttpTimeoutMs !== undefined) {
    out.steamHttpTimeoutMs = num(doc.steamHttpTimeoutMs, base.steamHttpTimeoutMs);
  }

  if (typeof doc.steamAutoSyncEnabled === 'boolean') {
    out.steamAutoSyncEnabled = doc.steamAutoSyncEnabled;
  }

  if (doc.steamAutoSyncIntervalMs !== undefined) {
    out.steamAutoSyncIntervalMs = num(doc.steamAutoSyncIntervalMs, base.steamAutoSyncIntervalMs);
  }
  if (doc.steamAutoSyncBatchSize !== undefined) {
    out.steamAutoSyncBatchSize = num(doc.steamAutoSyncBatchSize, base.steamAutoSyncBatchSize);
  }
  if (doc.steamAutoSyncDelayMs !== undefined) {
    out.steamAutoSyncDelayMs = num(doc.steamAutoSyncDelayMs, base.steamAutoSyncDelayMs);
  }

  if (doc.videoGcsBucket !== undefined) {
    const v = str(doc.videoGcsBucket);
    out.videoGcsBucket = v;
  }
  if (doc.ffmpegPath !== undefined) {
    const v = str(doc.ffmpegPath);
    if (v !== undefined) out.ffmpegPath = v;
  }
  if (doc.ffprobePath !== undefined) {
    const v = str(doc.ffprobePath);
    if (v !== undefined) out.ffprobePath = v;
  }
  if (doc.ytDlpPath !== undefined) {
    const v = str(doc.ytDlpPath);
    if (v !== undefined) out.ytDlpPath = v;
  }
  if (doc.videoTempDir !== undefined) {
    const v = str(doc.videoTempDir);
    if (v !== undefined) out.videoTempDir = v;
  }
  if (doc.videoMaxDurationSec !== undefined) {
    out.videoMaxDurationSec = num(doc.videoMaxDurationSec, base.videoMaxDurationSec);
  }
  if (doc.videoTrimSec !== undefined) {
    out.videoTrimSec = num(doc.videoTrimSec, base.videoTrimSec);
  }
  if (doc.videoSignedUrlMinutes !== undefined) {
    out.videoSignedUrlMinutes = num(doc.videoSignedUrlMinutes, base.videoSignedUrlMinutes);
  }
  if (doc.videoWorkerIntervalMs !== undefined) {
    out.videoWorkerIntervalMs = num(doc.videoWorkerIntervalMs, base.videoWorkerIntervalMs);
  }

  if (doc.appConnectTimeoutSec !== undefined) {
    out.appConnectTimeoutSec = num(doc.appConnectTimeoutSec, base.appConnectTimeoutSec ?? 15);
  }
  if (doc.appReceiveTimeoutSec !== undefined) {
    out.appReceiveTimeoutSec = num(doc.appReceiveTimeoutSec, base.appReceiveTimeoutSec ?? 90);
  }

  return out;
}

/** Merged server env: Firestore overrides on top of process env defaults. Cached ~60s to avoid per-request Firestore reads. */
export async function getEffectiveEnv(base: Env): Promise<Env> {
  const now = Date.now();
  if (cached && cachedBase === base && now - cacheAt < TTL_MS) {
    return cached;
  }

  const repo = new AdminSettingsRepository();
  const doc = await repo.getRuntime();
  const merged = mergeEnv(base, doc);
  cached = merged;
  cachedBase = base;
  cacheAt = now;
  return merged;
}
