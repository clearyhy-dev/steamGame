import admin from 'firebase-admin';
import { getFirestore } from '../../config/firebase';
import { useSqliteRelationalStore } from '../../config/database';
import * as sqliteRegion from '../../storage/sqlite/region-country.store';
import { sqlRun } from '../../storage/sqlite/sql-client';
import { nowMs } from '../../storage/sqlite/timestamp';
import { REGION_COUNTRY_DEFAULTS } from './region-country.defaults';
import { defaultCurrencySymbol, effectiveCurrencySymbol } from './currency-symbol.util';
import { CHEAPSHARK_LIST_COUNTRY, ggDealsRegionFromSteamCc } from './deal-provider-region.catalog';
import { DEFAULT_T1_COUNTRY_CODES, normalizeMarketSyncTier } from './market-sync-tier.config';

const COL = 'region_country_configs';

export type RegionCountryConfigDoc = {
  countryCode: string;
  countryName: string;
  nativeName?: string;
  steamCc: string;
  /** ITAD `country`（ISO2 大写）；空则使用 countryCode */
  itadCountry?: string;
  /** GG.deals `region`（通常小写 ISO2）；空则使用 countryCode */
  ggDealsRegion?: string;
  /** CheapShark 部分接口 `country`（ISO2 大写）；空则使用 countryCode */
  cheapsharkCountry?: string;
  defaultCurrency: string;
  currencySymbol: string;
  steamLanguage: string;
  uiLanguage: string;
  enabled: boolean;
  sortOrder: number;
  /** 分层折扣同步：T1 高频大 TopN；T2 低频小 TopN */
  syncTier?: MarketSyncTier;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
};

export type MarketSyncTier = 'T1' | 'T2';

/** 与 Steam 解耦：各比价/折扣 API 使用各自国家或区域码（Admin Country/Steam 页可配）。 */
export type DealProviderCountryCodes = {
  /** Steam Store `cc` 参数（小写 ISO2） */
  steamStoreCc: string;
  itadCountry: string;
  ggDealsRegion: string;
  cheapsharkCountry: string;
};

export type ResolvedCountryForSteam = {
  countryCode: string;
  countryName: string;
  nativeName: string;
  steamCc: string;
  steamLanguage: string;
  defaultCurrency: string;
  currencySymbol: string;
  uiLanguage: string;
};

/** App `supportedLocales` — uiLanguage 只能是这些之一，否则回退 en。 */
export const APP_SUPPORTED_UI_LANGUAGES = new Set([
  'en', 'zh', 'ja', 'ko', 'fr', 'ru', 'de', 'es',
  'ur', 'id', 'tr', 'vi', 'th', 'hi', 'pt', 'ar',
  'pl', 'it', 'nl', 'sv', 'he', 'el',
]);

/**
 * App 有对应语言的国家 → 默认用该语言（如 FR→fr）。
 * 仅英文区 / 未列出的国家 → en。
 * Admin 显式写成其它「非 en」App 语言时保留；历史种子全表 en 会对「有本国语言」的国家自动纠正。
 */
const UI_LANGUAGE_BY_COUNTRY: Record<string, string> = {
  US: 'en',
  GB: 'en',
  AU: 'en',
  NZ: 'en',
  IE: 'en',
  CA: 'en',
  CN: 'zh',
  TW: 'zh',
  HK: 'zh',
  SG: 'zh',
  JP: 'ja',
  KR: 'ko',
  FR: 'fr',
  BE: 'fr',
  DE: 'de',
  AT: 'de',
  CH: 'de',
  BR: 'pt',
  PT: 'pt',
  PL: 'pl',
  ES: 'es',
  MX: 'es',
  AR: 'es',
  CL: 'es',
  CO: 'es',
  PE: 'es',
  IT: 'it',
  RU: 'ru',
  UA: 'ru',
  TR: 'tr',
  VN: 'vi',
  TH: 'th',
  ID: 'id',
  IN: 'hi',
  PK: 'ur',
  SA: 'ar',
  AE: 'ar',
  EG: 'ar',
  IL: 'he',
  GR: 'el',
  NL: 'nl',
  SE: 'sv',
};

function normalizeUiLanguage(value: string): string {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return '';
  if (v.startsWith('zh')) return 'zh';
  if (v === 'schinese' || v === 'tchinese') return 'zh';
  return v.split(/[-_]/)[0] || '';
}

/**
 * 默认：用 Steam 商店 `cc`（steamCc）推导三平台参数，仅作**起点**。
 * 平台侧说明见：`deal-provider-region.catalog.ts`。
 */
export function dealProviderCodesFromSteamCc(steamCc: string): DealProviderCountryCodes {
  const cc = String(steamCc ?? '')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const safe = /^[A-Z]{2}$/.test(cc) ? cc : 'US';
  return {
    steamStoreCc: safe.toLowerCase(),
    itadCountry: safe,
    ggDealsRegion: ggDealsRegionFromSteamCc(safe),
    cheapsharkCountry: CHEAPSHARK_LIST_COUNTRY,
  };
}

/** 供 Admin/公开列表展示与写入：最终一定是 App supportedLocales 之一。 */
export function inferUiLanguage(input: {
  countryCode?: string;
  steamLanguage?: string;
  uiLanguage?: string;
}): string {
  const country = String(input.countryCode ?? '').trim().toUpperCase();
  const mappedRaw = normalizeUiLanguage(UI_LANGUAGE_BY_COUNTRY[country] ?? '');
  const mapped =
    mappedRaw && APP_SUPPORTED_UI_LANGUAGES.has(mappedRaw) ? mappedRaw : '';
  const explicitRaw = normalizeUiLanguage(input.uiLanguage ?? '');
  const explicit =
    explicitRaw && APP_SUPPORTED_UI_LANGUAGES.has(explicitRaw) ? explicitRaw : '';

  // 该国在 App 里有专属语言（非纯 en 区）：空值或历史默认 en → 用专属语言
  if (mapped && mapped !== 'en') {
    if (!explicit || explicit === 'en') return mapped;
    return explicit;
  }

  // 英文区 / 未映射国家：尊重已存 App 语言，否则 en
  if (explicit) return explicit;
  if (mapped) return mapped;

  const fromSteam = normalizeUiLanguage(input.steamLanguage ?? '');
  if (fromSteam && APP_SUPPORTED_UI_LANGUAGES.has(fromSteam)) return fromSteam;
  return 'en';
}

export class RegionCountryRepository {
  private db = getFirestore();

  async listAllForAdmin(): Promise<RegionCountryConfigDoc[]> {
    if (useSqliteRelationalStore()) {
      await sqliteRegion.sqliteEnsureRegionSyncTierColumn();
      return sqliteRegion.sqliteListAllRegionCountries();
    }
    const snap = await this.db.collection(COL).get();
    if (snap.empty) {
      await this.seedDefaults();
      return this.listAllForAdmin();
    }
    const rows = snap.docs.map((d) => d.data() as RegionCountryConfigDoc);
    rows.sort((a, b) => a.sortOrder - b.sortOrder || a.countryCode.localeCompare(b.countryCode));
    return rows;
  }

  async listEnabledPublic(): Promise<RegionCountryConfigDoc[]> {
    if (useSqliteRelationalStore()) {
      await sqliteRegion.sqliteEnsureRegionSyncTierColumn();
      return sqliteRegion.sqliteListEnabledRegionCountries();
    }
    const snap = await this.db.collection(COL).get();
    if (snap.empty) {
      await this.seedDefaults();
      return this.listEnabledPublic();
    }
    const rows = snap.docs
      .map((d) => d.data() as RegionCountryConfigDoc)
      .filter((r) => r.enabled === true);
    rows.sort((a, b) => a.sortOrder - b.sortOrder || a.countryCode.localeCompare(b.countryCode));
    return rows;
  }

  /** Document from Firestore, or null if none (caller may use defaults seed). */
  async getByCountryCode(code: string): Promise<RegionCountryConfigDoc | null> {
    const c = String(code ?? '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{2}$/.test(c)) return null;
    if (useSqliteRelationalStore()) return sqliteRegion.sqliteGetRegionByCode(c);
    const ref = this.db.collection(COL).doc(c);
    const d = await ref.get();
    if (!d.exists) return null;
    return d.data() as RegionCountryConfigDoc;
  }

  /**
   * ITAD / GG.deals / CheapShark 用的国家或区域码；未配置时与 App `countryCode`（ISO2）一致。
   */
  async resolveDealProviderCodes(countryCode: string): Promise<DealProviderCountryCodes> {
    const safe = String(countryCode ?? '')
      .trim()
      .toUpperCase();
    const base = /^[A-Z]{2}$/.test(safe) ? safe : 'US';
    const doc = await this.getByCountryCode(base);
    if (doc?.enabled) {
      const steam = String(doc.steamCc ?? '')
        .trim()
        .toUpperCase();
      const steamBase = /^[A-Z]{2}$/.test(steam) ? steam : base;
      const def = dealProviderCodesFromSteamCc(steamBase);
      const itad = String(doc.itadCountry ?? '')
        .trim()
        .toUpperCase();
      const gg = String(doc.ggDealsRegion ?? '')
        .trim()
        .toLowerCase();
      const cs = String(doc.cheapsharkCountry ?? '')
        .trim()
        .toUpperCase();
      return {
        steamStoreCc: steamBase.toLowerCase(),
        itadCountry: /^[A-Z]{2}$/.test(itad) ? itad : def.itadCountry,
        ggDealsRegion: /^[a-z]{2}$/.test(gg) ? gg : def.ggDealsRegion,
        cheapsharkCountry: /^[A-Z]{2}$/.test(cs) ? cs : def.cheapsharkCountry,
      };
    }
    const seed = REGION_COUNTRY_DEFAULTS.find((x) => x.countryCode === base);
    if (seed) return dealProviderCodesFromSteamCc(seed.steamCc);
    return dealProviderCodesFromSteamCc(base);
  }

  /**
   * Resolves Steam cc + language for an app country. Disabled Firestore rows fall back to cc=country.
   * Unknown ISO codes use passthrough cc + en + USD.
   */
  async resolveForRegionalDetail(countryCode: string): Promise<ResolvedCountryForSteam> {
    const c = String(countryCode ?? '')
      .trim()
      .toUpperCase();
    const safe = /^[A-Z]{2}$/.test(c) ? c : 'US';
    const rowDoc = await this.getByCountryCode(safe);
    if (rowDoc) {
      const row = rowDoc;
      if (!row.enabled) {
        return {
          countryCode: safe,
          countryName: row.countryName || safe,
          nativeName: row.nativeName ?? '',
          steamCc: safe,
          steamLanguage: 'en',
          defaultCurrency: 'USD',
          currencySymbol: defaultCurrencySymbol('USD'),
          uiLanguage: inferUiLanguage({ countryCode: safe, steamLanguage: 'en' }),
        };
      }
      return {
        countryCode: row.countryCode,
        countryName: row.countryName,
        nativeName: row.nativeName ?? '',
        steamCc: row.steamCc,
        steamLanguage: row.steamLanguage,
        defaultCurrency: row.defaultCurrency,
        currencySymbol: effectiveCurrencySymbol(row.defaultCurrency, row.currencySymbol),
        uiLanguage: inferUiLanguage(row),
      };
    }
    const seed = REGION_COUNTRY_DEFAULTS.find((x) => x.countryCode === safe);
    if (seed) {
      return {
        countryCode: seed.countryCode,
        countryName: seed.countryName,
        nativeName: seed.nativeName ?? '',
        steamCc: seed.steamCc,
        steamLanguage: seed.steamLanguage,
        defaultCurrency: seed.defaultCurrency,
        currencySymbol: effectiveCurrencySymbol(seed.defaultCurrency, seed.currencySymbol),
        uiLanguage: inferUiLanguage(seed),
      };
    }
    return {
      countryCode: safe,
      countryName: safe,
      nativeName: '',
      steamCc: safe,
      steamLanguage: 'en',
      defaultCurrency: 'USD',
      currencySymbol: defaultCurrencySymbol('USD'),
      uiLanguage: inferUiLanguage({ countryCode: safe, steamLanguage: 'en' }),
    };
  }

  async seedDefaults(): Promise<void> {
    if (useSqliteRelationalStore()) {
      await sqliteRegion.sqliteSeedRegionDefaults();
      return;
    }
    const batch = this.db.batch();
    const now = admin.firestore.Timestamp.now();
    for (const row of REGION_COUNTRY_DEFAULTS) {
      const ref = this.db.collection(COL).doc(row.countryCode);
      const prov = dealProviderCodesFromSteamCc(row.steamCc);
      batch.set(
        ref,
        {
          countryCode: row.countryCode,
          countryName: row.countryName,
          nativeName: row.nativeName ?? '',
          steamCc: row.steamCc,
          itadCountry: prov.itadCountry,
          ggDealsRegion: prov.ggDealsRegion,
          cheapsharkCountry: prov.cheapsharkCountry,
          defaultCurrency: row.defaultCurrency,
          currencySymbol: row.currencySymbol || defaultCurrencySymbol(row.defaultCurrency),
          steamLanguage: row.steamLanguage,
          uiLanguage: inferUiLanguage(row),
          enabled: true,
          sortOrder: row.sortOrder,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true },
      );
    }
    await batch.commit();
  }

  async upsert(
    input: Partial<RegionCountryConfigDoc> & { countryCode: string },
  ): Promise<RegionCountryConfigDoc> {
    if (useSqliteRelationalStore()) return sqliteRegion.sqliteUpsertRegion(input);
    const code = String(input.countryCode)
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) throw new Error('countryCode must be 2 letters');
    const ref = this.db.collection(COL).doc(code);
    const old = await ref.get();
    const now = admin.firestore.Timestamp.now();
    const prev = old.exists ? (old.data() as RegionCountryConfigDoc) : null;
    const pickItad = (): string => {
      if (input.itadCountry === undefined) return String(prev?.itadCountry ?? '').trim();
      const s = String(input.itadCountry).trim().toUpperCase();
      if (!s) return '';
      if (!/^[A-Z]{2}$/.test(s)) throw new Error('itadCountry must be ISO 3166-1 alpha-2 or empty');
      return s;
    };
    const pickGg = (): string => {
      if (input.ggDealsRegion === undefined) return String(prev?.ggDealsRegion ?? '').trim();
      const s = String(input.ggDealsRegion).trim().toLowerCase();
      if (!s) return '';
      if (!/^[a-z]{2}$/.test(s)) throw new Error('ggDealsRegion must be 2-letter region or empty');
      return s;
    };
    const pickCs = (): string => {
      if (input.cheapsharkCountry === undefined) return String(prev?.cheapsharkCountry ?? '').trim();
      const s = String(input.cheapsharkCountry).trim().toUpperCase();
      if (!s) return '';
      if (!/^[A-Z]{2}$/.test(s)) throw new Error('cheapsharkCountry must be ISO 3166-1 alpha-2 or empty');
      return s;
    };

    const row: RegionCountryConfigDoc = {
      countryCode: code,
      countryName: String(input.countryName ?? prev?.countryName ?? code).trim(),
      nativeName: input.nativeName !== undefined ? String(input.nativeName) : prev?.nativeName ?? '',
      steamCc: String(input.steamCc ?? prev?.steamCc ?? code)
        .trim()
        .toUpperCase(),
      itadCountry: pickItad(),
      ggDealsRegion: pickGg(),
      cheapsharkCountry: pickCs(),
      defaultCurrency: String(input.defaultCurrency ?? prev?.defaultCurrency ?? 'USD')
        .trim()
        .toUpperCase(),
      currencySymbol: String(input.currencySymbol ?? prev?.currencySymbol ?? '')
        .trim(),
      steamLanguage: String(input.steamLanguage ?? prev?.steamLanguage ?? 'en').trim().toLowerCase(),
      uiLanguage: inferUiLanguage({
        countryCode: code,
        steamLanguage: String(input.steamLanguage ?? prev?.steamLanguage ?? 'en'),
        uiLanguage: String(input.uiLanguage ?? prev?.uiLanguage ?? ''),
      }),
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : (prev?.enabled ?? true),
      sortOrder: input.sortOrder !== undefined ? Number(input.sortOrder) : (prev?.sortOrder ?? 500),
      syncTier:
        input.syncTier !== undefined
          ? normalizeMarketSyncTier(input.syncTier)
          : normalizeMarketSyncTier(prev?.syncTier),
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    if (!/^[A-Z]{2}$/.test(row.steamCc)) throw new Error('steamCc must be 2 letters');
    if (!/^[A-Z]{3}$/.test(row.defaultCurrency)) throw new Error('defaultCurrency must be 3 letters');
    row.currencySymbol = effectiveCurrencySymbol(row.defaultCurrency, row.currencySymbol);
    const provFill = dealProviderCodesFromSteamCc(row.steamCc);
    if (!String(row.itadCountry ?? '').trim()) row.itadCountry = provFill.itadCountry;
    if (!String(row.ggDealsRegion ?? '').trim()) row.ggDealsRegion = provFill.ggDealsRegion;
    if (!String(row.cheapsharkCountry ?? '').trim()) row.cheapsharkCountry = provFill.cheapsharkCountry;
    await ref.set(row);
    return row;
  }

  async setEnabled(countryCode: string, enabled: boolean): Promise<void> {
    const c = String(countryCode).trim().toUpperCase();
    if (useSqliteRelationalStore()) {
      await sqlRun('UPDATE region_country_configs SET enabled = ?, updated_at_ms = ? WHERE country_code = ?', [
        enabled ? 1 : 0,
        nowMs(),
        c,
      ]);
      return;
    }
    await this.db
      .collection(COL)
      .doc(c)
      .set({ enabled, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
  }

  async setSyncTier(countryCode: string, syncTier: MarketSyncTier): Promise<void> {
    const c = String(countryCode).trim().toUpperCase();
    const tier = normalizeMarketSyncTier(syncTier);
    if (useSqliteRelationalStore()) {
      await sqliteRegion.sqliteEnsureRegionSyncTierColumn();
      await sqlRun('UPDATE region_country_configs SET sync_tier = ?, updated_at_ms = ? WHERE country_code = ?', [
        tier,
        nowMs(),
        c,
      ]);
      return;
    }
    await this.db.collection(COL).doc(c).set(
      { syncTier: tier, updatedAt: admin.firestore.Timestamp.now() },
      { merge: true },
    );
  }

  /** 首次迁移：按 DEFAULT_T1_COUNTRY_CODES 写入 T1，其余 T2（不覆盖已有非空 sync_tier） */
  async backfillDefaultSyncTiers(force = false): Promise<{ updated: number }> {
    if (useSqliteRelationalStore()) {
      return sqliteRegion.sqliteBackfillDefaultSyncTiers(force);
    }
    const snap = await this.db.collection(COL).get();
    let updated = 0;
    const batch = this.db.batch();
    for (const doc of snap.docs) {
      const row = doc.data() as RegionCountryConfigDoc;
      const cc = String(row.countryCode ?? doc.id).trim().toUpperCase();
      const want = DEFAULT_T1_COUNTRY_CODES.has(cc) ? 'T1' : 'T2';
      const cur = normalizeMarketSyncTier(row.syncTier);
      if (!force && row.syncTier != null && String(row.syncTier).trim() !== '') continue;
      if (!force && cur === want) continue;
      batch.set(doc.ref, { syncTier: want, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
      updated++;
    }
    if (updated > 0) await batch.commit();
    return { updated };
  }

  /**
   * 将 ITAD / GG / CS 与当前行的 steamCc 对齐并写入 Firestore。
   * @param force 为 true 时覆盖已有非空值；默认仅补空白字段。
   */
  async backfillDealProviderCodesFromSteamCc(force = false): Promise<{ updated: number }> {
    if (useSqliteRelationalStore()) {
      const rows = await sqliteRegion.sqliteListAllRegionCountries();
      let updated = 0;
      for (const row of rows) {
        const steam = String(row.steamCc ?? row.countryCode).trim().toUpperCase();
        if (!/^[A-Z]{2}$/.test(steam)) continue;
        const prov = dealProviderCodesFromSteamCc(steam);
        const itadEmpty = !String(row.itadCountry ?? '').trim();
        const ggEmpty = !String(row.ggDealsRegion ?? '').trim();
        const csEmpty = !String(row.cheapsharkCountry ?? '').trim();
        const nextItad = force ? prov.itadCountry : itadEmpty ? prov.itadCountry : String(row.itadCountry).trim().toUpperCase();
        const nextGg = force ? prov.ggDealsRegion : ggEmpty ? prov.ggDealsRegion : String(row.ggDealsRegion).trim().toLowerCase();
        const nextCs = force ? prov.cheapsharkCountry : csEmpty ? prov.cheapsharkCountry : String(row.cheapsharkCountry).trim().toUpperCase();
        if (
          String(row.itadCountry ?? '').trim().toUpperCase() === nextItad &&
          String(row.ggDealsRegion ?? '').trim().toLowerCase() === nextGg &&
          String(row.cheapsharkCountry ?? '').trim().toUpperCase() === nextCs
        ) {
          continue;
        }
        await sqliteRegion.sqliteUpsertRegion({
          ...row,
          itadCountry: nextItad,
          ggDealsRegion: nextGg,
          cheapsharkCountry: nextCs,
        });
        updated += 1;
      }
      return { updated };
    }
    const snap = await this.db.collection(COL).get();
    if (snap.empty) {
      await this.seedDefaults();
      return this.backfillDealProviderCodesFromSteamCc(force);
    }
    const now = admin.firestore.Timestamp.now();
    let updated = 0;
    let batch = this.db.batch();
    let ops = 0;

    const flush = async () => {
      if (ops === 0) return;
      await batch.commit();
      batch = this.db.batch();
      ops = 0;
    };

    for (const d of snap.docs) {
      const row = d.data() as RegionCountryConfigDoc;
      const steam = String(row.steamCc ?? row.countryCode ?? '')
        .trim()
        .toUpperCase();
      if (!/^[A-Z]{2}$/.test(steam)) continue;
      const prov = dealProviderCodesFromSteamCc(steam);
      const itadEmpty = !String(row.itadCountry ?? '').trim();
      const ggEmpty = !String(row.ggDealsRegion ?? '').trim();
      const csEmpty = !String(row.cheapsharkCountry ?? '').trim();

      const nextItad = force ? prov.itadCountry : itadEmpty ? prov.itadCountry : String(row.itadCountry).trim().toUpperCase();
      const nextGg = force ? prov.ggDealsRegion : ggEmpty ? prov.ggDealsRegion : String(row.ggDealsRegion).trim().toLowerCase();
      const nextCs = force
        ? prov.cheapsharkCountry
        : csEmpty
          ? prov.cheapsharkCountry
          : String(row.cheapsharkCountry).trim().toUpperCase();

      if (
        String(row.itadCountry ?? '').trim().toUpperCase() === nextItad &&
        String(row.ggDealsRegion ?? '').trim().toLowerCase() === nextGg &&
        String(row.cheapsharkCountry ?? '').trim().toUpperCase() === nextCs
      ) {
        continue;
      }
      batch.set(
        d.ref,
        {
          itadCountry: nextItad,
          ggDealsRegion: nextGg,
          cheapsharkCountry: nextCs,
          updatedAt: now,
        },
        { merge: true },
      );
      ops += 1;
      updated += 1;
      if (ops >= 400) await flush();
    }
    await flush();
    return { updated };
  }

  /** 将 currency_symbol 修正为与 defaultCurrency 一致（修复历史误填为 `$` 的记录） */
  async backfillCurrencySymbols(force = false): Promise<{ updated: number }> {
    if (useSqliteRelationalStore()) {
      const rows = await sqliteRegion.sqliteListAllRegionCountries();
      let updated = 0;
      for (const row of rows) {
        const next = effectiveCurrencySymbol(row.defaultCurrency, row.currencySymbol);
        if (!force && next === row.currencySymbol) continue;
        await sqliteRegion.sqliteUpsertRegion({ ...row, currencySymbol: next });
        updated += 1;
      }
      return { updated };
    }
    const snap = await this.db.collection(COL).get();
    if (snap.empty) {
      await this.seedDefaults();
      return this.backfillCurrencySymbols(force);
    }
    const now = admin.firestore.Timestamp.now();
    let updated = 0;
    let batch = this.db.batch();
    let ops = 0;
    const flush = async () => {
      if (ops === 0) return;
      await batch.commit();
      batch = this.db.batch();
      ops = 0;
    };
    for (const d of snap.docs) {
      const row = d.data() as RegionCountryConfigDoc;
      const next = effectiveCurrencySymbol(row.defaultCurrency, row.currencySymbol);
      if (!force && next === row.currencySymbol) continue;
      batch.set(d.ref, { currencySymbol: next, updatedAt: now }, { merge: true });
      ops += 1;
      updated += 1;
      if (ops >= 400) await flush();
    }
    await flush();
    return { updated };
  }
}
