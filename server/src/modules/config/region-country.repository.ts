import admin from 'firebase-admin';
import { getFirestore } from '../../config/firebase';
import { useSqliteRelationalStore } from '../../config/database';
import * as sqliteRegion from '../../storage/sqlite/region-country.store';
import { sqlRun } from '../../storage/sqlite/sql-client';
import { nowMs } from '../../storage/sqlite/timestamp';
import { REGION_COUNTRY_DEFAULTS } from './region-country.defaults';
import { defaultCurrencySymbol, effectiveCurrencySymbol } from './currency-symbol.util';
import { CHEAPSHARK_LIST_COUNTRY, ggDealsRegionFromSteamCc } from './deal-provider-region.catalog';

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
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
};

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

const UI_LANGUAGE_BY_COUNTRY: Record<string, string> = {
  US: 'en',
  GB: 'en',
  AU: 'en',
  CA: 'en',
  CN: 'zh',
  TW: 'zh',
  HK: 'zh',
  JP: 'ja',
  KR: 'ko',
  FR: 'fr',
  DE: 'de',
  BR: 'pt',
  PT: 'pt',
  PL: 'pl',
  ES: 'es',
  IT: 'it',
  RU: 'ru',
};

function normalizeUiLanguage(value: string): string {
  const v = String(value ?? '').trim().toLowerCase();
  if (!v) return '';
  if (v.startsWith('zh')) return 'zh';
  if (v === 'schinese' || v === 'tchinese') return 'zh';
  return v.split(/[-_]/)[0] || '';
}

/**
 * 默认：用 Steam 商店 `cc`（steamCc）推导三平台参数，仅作**起点**，不保证与各服务商文档完全一致。
 *
 * - **Steam**：`cc` 为 ISO 3166-1 alpha-2（大写），是区域价的基准。
 * - **IsThereAnyDeal**：`country` 一般为 **ISO2 大写**，与 Steam 区域价体系通常最接近；边缘区仍建议用真实 API 抽测。
 * - **GG.deals**：`region` 多为小写两位码，但公开文档对取值列表说明较少，可能与 Steam 不一致（如 `uk`/`gb` 等）；**以接口为准**，可在 Admin 列单独覆盖。
 * - **CheapShark**：列表 API 的 `country` 实测不改变 deal；统一 **`US`**，勿与 Steam 区价混为一谈。
 *
 * 「按国家取折扣价」：ITAD/GG 用本表；CheapShark 仅作全球 deal 参考。勿把 UI 国家名直传 API。
 *
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

export function inferUiLanguage(input: {
  countryCode?: string;
  steamLanguage?: string;
  uiLanguage?: string;
}): string {
  const explicit = normalizeUiLanguage(input.uiLanguage ?? '');
  if (explicit) return explicit;
  const country = String(input.countryCode ?? '').trim().toUpperCase();
  const fromCountry = normalizeUiLanguage(UI_LANGUAGE_BY_COUNTRY[country] ?? '');
  if (fromCountry) return fromCountry;
  const fromSteam = normalizeUiLanguage(input.steamLanguage ?? '');
  return fromSteam || 'en';
}

export class RegionCountryRepository {
  private db = getFirestore();

  async listAllForAdmin(): Promise<RegionCountryConfigDoc[]> {
    if (useSqliteRelationalStore()) return sqliteRegion.sqliteListAllRegionCountries();
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
    if (useSqliteRelationalStore()) return sqliteRegion.sqliteListEnabledRegionCountries();
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
