import admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirestore } from '../../config/firebase';

const COLLECTION = 'system_config';
const DOC_DISCOUNT = 'discount_providers';
const DOC_RUNTIME = 'runtime';
const DOC_REGION_SETTINGS = 'region_settings';

const DEFAULT_ENABLED_COUNTRIES = ['US', 'IN', 'JP', 'BR', 'PL', 'FR', 'DE', 'CN'] as const;
const DEFAULT_COUNTRY_CURRENCY_MAP: Record<string, string> = {
  US: 'USD',
  IN: 'INR',
  JP: 'JPY',
  BR: 'BRL',
  PL: 'PLN',
  FR: 'EUR',
  DE: 'EUR',
  CN: 'CNY',
};
const DEFAULT_COUNTRY_LANGUAGE_MAP: Record<string, string> = {
  US: 'en',
  IN: 'en',
  JP: 'ja',
  BR: 'pt',
  PL: 'pl',
  FR: 'fr',
  DE: 'de',
  CN: 'zh',
};
const DEFAULT_PRICE_SOURCES = ['steam', 'itad', 'ggdeals', 'cheapshark'] as const;

export type DiscountProvidersConfig = {
  itadApiKey: string;
  ggDealsApiKey: string;
  itadBaseUrl: string;
  ggDealsBaseUrl: string;
  cheapSharkBaseUrl: string;
  dealCountriesCsv: string;
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
  appSupportedDealCountriesCsv?: string;
  appCountryMapJson?: string;
  appCountryCurrencyMapJson?: string;
  updatedAt: admin.firestore.Timestamp;
  createdAt: admin.firestore.Timestamp;
};

export type RegionSettingsDoc = {
  enabledCountries: string[];
  defaultCountry: string;
  fallbackCountry: string;
  countryCurrencyMap: Record<string, string>;
  countryLanguageMap: Record<string, string>;
  priceSources: string[];
  cacheHours: number;
  showKeyshopDeals: boolean;
  showRegionWarning: boolean;
  updatedAt: admin.firestore.Timestamp;
  createdAt: admin.firestore.Timestamp;
};

export type RegionSettings = Omit<RegionSettingsDoc, 'updatedAt' | 'createdAt'>;

const RUNTIME_OVERRIDE_KEYS: (keyof RuntimeConfigDoc)[] = [
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
  'appSupportedDealCountriesCsv',
  'appCountryMapJson',
  'appCountryCurrencyMapJson',
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

  private normalizeCountryCode(raw: unknown): string | null {
    const v = String(raw ?? '').trim().toUpperCase();
    return /^[A-Z]{2}$/.test(v) ? v : null;
  }

  private normalizeLanguageCode(raw: unknown): string {
    const v = String(raw ?? '').trim().toLowerCase();
    return /^[a-z]{2,5}$/.test(v) ? v : 'en';
  }

  private normalizeCurrencyCode(raw: unknown): string {
    const v = String(raw ?? '').trim().toUpperCase();
    return /^[A-Z]{3}$/.test(v) ? v : 'USD';
  }

  private normalizePriceSource(raw: unknown): string | null {
    const v = String(raw ?? '').trim().toLowerCase();
    return v ? v : null;
  }

  private normalizeRegionSettings(input: Partial<RegionSettings> | undefined | null): RegionSettings {
    const enabled = Array.isArray(input?.enabledCountries)
      ? input!.enabledCountries
          .map((c) => this.normalizeCountryCode(c))
          .filter((c): c is string => !!c)
      : [...DEFAULT_ENABLED_COUNTRIES];
    const enabledCountries = Array.from(new Set(enabled.length ? enabled : [...DEFAULT_ENABLED_COUNTRIES]));

    const fallbackCandidate = this.normalizeCountryCode(input?.fallbackCountry);
    const fallbackCountry =
      fallbackCandidate && enabledCountries.includes(fallbackCandidate)
        ? fallbackCandidate
        : enabledCountries.includes('US')
          ? 'US'
          : enabledCountries[0];

    const defaultCandidate = this.normalizeCountryCode(input?.defaultCountry);
    const defaultCountry =
      defaultCandidate && enabledCountries.includes(defaultCandidate) ? defaultCandidate : fallbackCountry;

    const countryCurrencyMapRaw = input?.countryCurrencyMap ?? {};
    const countryCurrencyMap: Record<string, string> = {};
    for (const code of enabledCountries) {
      const raw = (countryCurrencyMapRaw as Record<string, unknown>)[code] ?? DEFAULT_COUNTRY_CURRENCY_MAP[code];
      countryCurrencyMap[code] = this.normalizeCurrencyCode(raw);
    }

    const countryLanguageMapRaw = input?.countryLanguageMap ?? {};
    const countryLanguageMap: Record<string, string> = {};
    for (const code of enabledCountries) {
      const raw = (countryLanguageMapRaw as Record<string, unknown>)[code] ?? DEFAULT_COUNTRY_LANGUAGE_MAP[code];
      countryLanguageMap[code] = this.normalizeLanguageCode(raw);
    }

    const priceSourceRaw = Array.isArray(input?.priceSources) ? input!.priceSources : [...DEFAULT_PRICE_SOURCES];
    const priceSources = Array.from(
      new Set(priceSourceRaw.map((s) => this.normalizePriceSource(s)).filter((s): s is string => !!s)),
    );

    const cacheHoursRaw = Number(input?.cacheHours);
    const cacheHours = Number.isFinite(cacheHoursRaw)
      ? Math.min(168, Math.max(1, Math.round(cacheHoursRaw)))
      : 6;

    return {
      enabledCountries,
      defaultCountry,
      fallbackCountry,
      countryCurrencyMap,
      countryLanguageMap,
      priceSources: priceSources.length ? priceSources : [...DEFAULT_PRICE_SOURCES],
      cacheHours,
      showKeyshopDeals: input?.showKeyshopDeals === undefined ? true : !!input.showKeyshopDeals,
      showRegionWarning: input?.showRegionWarning === undefined ? true : !!input.showRegionWarning,
    };
  }

  async getDiscountProviders(): Promise<DiscountProvidersConfig> {
    const ref = this.db.collection(COLLECTION).doc(DOC_DISCOUNT);
    const snap = await ref.get();
    if (!snap.exists) {
      const now = admin.firestore.Timestamp.now();
      const init: DiscountProvidersConfig = {
        itadApiKey: '',
        ggDealsApiKey: '',
        itadBaseUrl: 'https://api.isthereanydeal.com',
        ggDealsBaseUrl: 'https://api.gg.deals',
        cheapSharkBaseUrl: 'https://www.cheapshark.com/api/1.0',
        dealCountriesCsv: 'US,CN,JP',
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
      itadBaseUrl: String(d.itadBaseUrl ?? 'https://api.isthereanydeal.com'),
      ggDealsBaseUrl: String(d.ggDealsBaseUrl ?? 'https://api.gg.deals'),
      cheapSharkBaseUrl: String(d.cheapSharkBaseUrl ?? 'https://www.cheapshark.com/api/1.0'),
      dealCountriesCsv: String(d.dealCountriesCsv ?? 'US,CN,JP'),
      updatedAt: d.updatedAt ?? now,
      createdAt: d.createdAt ?? now,
    };
  }

  async patchDiscountProviders(
    patch: Partial<Omit<DiscountProvidersConfig, 'updatedAt' | 'createdAt'>>,
  ): Promise<DiscountProvidersConfig> {
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

  async getRegionSettings(): Promise<RegionSettingsDoc> {
    const ref = this.db.collection(COLLECTION).doc(DOC_REGION_SETTINGS);
    const snap = await ref.get();
    const now = admin.firestore.Timestamp.now();
    if (!snap.exists) {
      const normalized = this.normalizeRegionSettings(undefined);
      const init: RegionSettingsDoc = {
        ...normalized,
        updatedAt: now,
        createdAt: now,
      };
      await ref.set(init, { merge: true });
      return init;
    }
    const d = (snap.data() ?? {}) as Partial<RegionSettingsDoc>;
    const normalized = this.normalizeRegionSettings({
      enabledCountries: d.enabledCountries,
      defaultCountry: d.defaultCountry,
      fallbackCountry: d.fallbackCountry,
      countryCurrencyMap: d.countryCurrencyMap,
      countryLanguageMap: d.countryLanguageMap,
      priceSources: d.priceSources,
      cacheHours: d.cacheHours,
      showKeyshopDeals: d.showKeyshopDeals,
      showRegionWarning: d.showRegionWarning,
    });
    return {
      ...normalized,
      updatedAt: d.updatedAt ?? now,
      createdAt: d.createdAt ?? now,
    };
  }

  async patchRegionSettings(
    patch: Partial<RegionSettings>,
  ): Promise<{ stored: RegionSettingsDoc; updatedAt: admin.firestore.Timestamp }> {
    const ref = this.db.collection(COLLECTION).doc(DOC_REGION_SETTINGS);
    const now = admin.firestore.Timestamp.now();
    const current = await this.getRegionSettings();
    const normalized = this.normalizeRegionSettings({
      ...current,
      ...patch,
    });
    await ref.set(
      {
        ...normalized,
        updatedAt: now,
        createdAt: current.createdAt ?? now,
      },
      { merge: true },
    );
    return {
      stored: {
        ...normalized,
        updatedAt: now,
        createdAt: current.createdAt ?? now,
      },
      updatedAt: now,
    };
  }
}
