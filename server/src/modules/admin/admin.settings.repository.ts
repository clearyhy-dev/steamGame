import admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from '../../config/firebase';
import { useSqliteRelationalStore } from '../../config/database';
import * as sqliteSettings from '../../storage/sqlite/admin-settings.store';

const COLLECTION = 'system_config';
const DOC_DISCOUNT = 'discount_providers';
const DOC_RUNTIME = 'runtime';

export type DiscountProvidersConfig = {
  itadApiKey: string;
  ggDealsApiKey: string;
  steamApiKey: string;
  itadBaseUrl: string;
  ggDealsBaseUrl: string;
  cheapSharkBaseUrl: string;
  steamWebApiBaseUrl: string;
  steamStoreBaseUrl: string;
  updatedAt: admin.firestore.Timestamp;
  createdAt: admin.firestore.Timestamp;
};

/** Stored overrides (merge on top of process env). */
export type RuntimeConfigDoc = {
  adminUsername?: string;
  adminPassword?: string;
  steamApiKey?: string;
  steamOpenidRealm?: string;
  steamOpenidReturnUrl?: string;
  appDeeplinkScheme?: string;
  appDeeplinkSuccessHost?: string;
  appDeeplinkFailHost?: string;
  appBaseUrl?: string;
  steamHttpTimeoutMs?: number;
  steamAutoSyncEnabled?: boolean;
  steamAutoSyncIntervalMs?: number;
  steamAutoSyncBatchSize?: number;
  steamAutoSyncDelayMs?: number;
  requestLogRetentionDays?: number;
  videoGcsBucket?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  ytDlpPath?: string;
  videoTempDir?: string;
  videoMaxDurationSec?: number;
  videoTrimSec?: number;
  videoSignedUrlMinutes?: number;
  videoWorkerIntervalMs?: number;
  appConnectTimeoutSec?: number;
  appReceiveTimeoutSec?: number;
  /** Optional override; empty = derive from appBaseUrl + /api/docs */
  appSwaggerUiUrl?: string;
  /** Optional override; empty = derive from appBaseUrl + /api/openapi.json */
  appOpenApiJsonUrl?: string;
  updatedAt: admin.firestore.Timestamp;
  createdAt: admin.firestore.Timestamp;
};

export const RUNTIME_OVERRIDE_KEYS: (keyof RuntimeConfigDoc)[] = [
  'adminUsername',
  'adminPassword',
  'steamApiKey',
  'steamOpenidRealm',
  'steamOpenidReturnUrl',
  'appDeeplinkScheme',
  'appDeeplinkSuccessHost',
  'appDeeplinkFailHost',
  'appBaseUrl',
  'steamHttpTimeoutMs',
  'steamAutoSyncEnabled',
  'steamAutoSyncIntervalMs',
  'steamAutoSyncBatchSize',
  'steamAutoSyncDelayMs',
  'requestLogRetentionDays',
  'videoGcsBucket',
  'ffmpegPath',
  'ffprobePath',
  'ytDlpPath',
  'videoTempDir',
  'videoMaxDurationSec',
  'videoTrimSec',
  'videoSignedUrlMinutes',
  'videoWorkerIntervalMs',
  'appConnectTimeoutSec',
  'appReceiveTimeoutSec',
  'appSwaggerUiUrl',
  'appOpenApiJsonUrl',
];

function stripForMerge(d: admin.firestore.DocumentData): Partial<RuntimeConfigDoc> {
  const out: Record<string, unknown> = {};
  for (const k of RUNTIME_OVERRIDE_KEYS) {
    if (d[k] !== undefined) out[k] = d[k];
  }
  return out as Partial<RuntimeConfigDoc>;
}

export class AdminSettingsRepository {
  private db = getFirestore();

  async getDiscountProviders(): Promise<DiscountProvidersConfig> {
    if (useSqliteRelationalStore()) return sqliteSettings.sqliteGetDiscountProviders();
    const ref = this.db.collection(COLLECTION).doc(DOC_DISCOUNT);
    const snap = await ref.get();
    if (!snap.exists) {
      const now = admin.firestore.Timestamp.now();
      const init: DiscountProvidersConfig = {
        itadApiKey: '',
        ggDealsApiKey: '',
        steamApiKey: '',
        itadBaseUrl: 'https://api.isthereanydeal.com',
        ggDealsBaseUrl: 'https://api.gg.deals',
        cheapSharkBaseUrl: 'https://www.cheapshark.com/api/1.0',
        steamWebApiBaseUrl: 'https://api.steampowered.com',
        steamStoreBaseUrl: 'https://store.steampowered.com',
        updatedAt: now,
        createdAt: now,
      };
      await ref.set(init, { merge: true });
      return init;
    }
    const d = snap.data() as Partial<DiscountProvidersConfig>;
    const now = admin.firestore.Timestamp.now();
    return {
      itadApiKey: String(d.itadApiKey ?? ''),
      ggDealsApiKey: String(d.ggDealsApiKey ?? ''),
      steamApiKey: String(d.steamApiKey ?? ''),
      itadBaseUrl: String(d.itadBaseUrl ?? 'https://api.isthereanydeal.com'),
      ggDealsBaseUrl: String(d.ggDealsBaseUrl ?? 'https://api.gg.deals'),
      cheapSharkBaseUrl: String(d.cheapSharkBaseUrl ?? 'https://www.cheapshark.com/api/1.0'),
      steamWebApiBaseUrl: String(d.steamWebApiBaseUrl ?? 'https://api.steampowered.com'),
      steamStoreBaseUrl: String(d.steamStoreBaseUrl ?? 'https://store.steampowered.com'),
      updatedAt: d.updatedAt ?? now,
      createdAt: d.createdAt ?? now,
    };
  }

  async patchDiscountProviders(
    patch: Partial<Omit<DiscountProvidersConfig, 'updatedAt' | 'createdAt'>>,
  ): Promise<DiscountProvidersConfig> {
    if (useSqliteRelationalStore()) return sqliteSettings.sqlitePatchDiscountProviders(patch);
    const ref = this.db.collection(COLLECTION).doc(DOC_DISCOUNT);
    const now = admin.firestore.Timestamp.now();
    await ref.set(
      {
        ...patch,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true },
    );
    return this.getDiscountProviders();
  }

  /** Raw Firestore overrides for merging into Env (no timestamps). */
  async getRuntime(): Promise<Partial<RuntimeConfigDoc>> {
    if (useSqliteRelationalStore()) return sqliteSettings.sqliteGetRuntime();
    const ref = this.db.collection(COLLECTION).doc(DOC_RUNTIME);
    const snap = await ref.get();
    if (!snap.exists) return {};
    const d = snap.data();
    if (!d) return {};
    return stripForMerge(d);
  }

  async patchRuntime(
    patch: Record<string, unknown>,
  ): Promise<{ stored: Partial<RuntimeConfigDoc>; updatedAt: admin.firestore.Timestamp }> {
    if (useSqliteRelationalStore()) return sqliteSettings.sqlitePatchRuntime(patch);
    const ref = this.db.collection(COLLECTION).doc(DOC_RUNTIME);
    const now = admin.firestore.Timestamp.now();
    const snap = await ref.get();

    const updatePayload: Record<string, unknown> = {
      updatedAt: now,
    };
    if (!snap.exists) {
      updatePayload.createdAt = now;
    }

    for (const [key, val] of Object.entries(patch)) {
      if (!RUNTIME_OVERRIDE_KEYS.includes(key as keyof RuntimeConfigDoc)) continue;
      if (val === undefined) continue;
      if (val === null || val === '') {
        updatePayload[key] = FieldValue.delete();
      } else {
        updatePayload[key] = val;
      }
    }

    await ref.set(updatePayload, { merge: true });
    const stored = await this.getRuntime();
    return { stored, updatedAt: now };
  }
}
