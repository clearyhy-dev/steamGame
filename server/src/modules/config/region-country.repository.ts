import admin from 'firebase-admin';
import { getFirestore } from '../../config/firebase';
import { REGION_COUNTRY_DEFAULTS } from './region-country.defaults';
import { defaultCurrencySymbol } from './currency-symbol.util';

const COL = 'region_country_configs';

export type RegionCountryConfigDoc = {
  countryCode: string;
  countryName: string;
  nativeName?: string;
  steamCc: string;
  defaultCurrency: string;
  currencySymbol: string;
  steamLanguage: string;
  enabled: boolean;
  sortOrder: number;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
};

export type ResolvedCountryForSteam = {
  countryCode: string;
  countryName: string;
  nativeName: string;
  steamCc: string;
  steamLanguage: string;
  defaultCurrency: string;
  currencySymbol: string;
};

export class RegionCountryRepository {
  private db = getFirestore();

  async listAllForAdmin(): Promise<RegionCountryConfigDoc[]> {
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
    const ref = this.db.collection(COL).doc(c);
    const d = await ref.get();
    if (!d.exists) return null;
    return d.data() as RegionCountryConfigDoc;
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
    const ref = this.db.collection(COL).doc(safe);
    const d = await ref.get();
    if (d.exists) {
      const row = d.data() as RegionCountryConfigDoc;
      if (!row.enabled) {
        return {
          countryCode: safe,
          countryName: row.countryName || safe,
          nativeName: row.nativeName ?? '',
          steamCc: safe,
          steamLanguage: 'en',
          defaultCurrency: 'USD',
          currencySymbol: defaultCurrencySymbol('USD'),
        };
      }
      return {
        countryCode: row.countryCode,
        countryName: row.countryName,
        nativeName: row.nativeName ?? '',
        steamCc: row.steamCc,
        steamLanguage: row.steamLanguage,
        defaultCurrency: row.defaultCurrency,
        currencySymbol: row.currencySymbol || defaultCurrencySymbol(row.defaultCurrency),
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
        currencySymbol: seed.currencySymbol || defaultCurrencySymbol(seed.defaultCurrency),
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
    };
  }

  async seedDefaults(): Promise<void> {
    const batch = this.db.batch();
    const now = admin.firestore.Timestamp.now();
    for (const row of REGION_COUNTRY_DEFAULTS) {
      const ref = this.db.collection(COL).doc(row.countryCode);
      batch.set(
        ref,
        {
          countryCode: row.countryCode,
          countryName: row.countryName,
          nativeName: row.nativeName ?? '',
          steamCc: row.steamCc,
          defaultCurrency: row.defaultCurrency,
          currencySymbol: row.currencySymbol || defaultCurrencySymbol(row.defaultCurrency),
          steamLanguage: row.steamLanguage,
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
    const code = String(input.countryCode)
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) throw new Error('countryCode must be 2 letters');
    const ref = this.db.collection(COL).doc(code);
    const old = await ref.get();
    const now = admin.firestore.Timestamp.now();
    const prev = old.exists ? (old.data() as RegionCountryConfigDoc) : null;
    const row: RegionCountryConfigDoc = {
      countryCode: code,
      countryName: String(input.countryName ?? prev?.countryName ?? code).trim(),
      nativeName: input.nativeName !== undefined ? String(input.nativeName) : prev?.nativeName ?? '',
      steamCc: String(input.steamCc ?? prev?.steamCc ?? code)
        .trim()
        .toUpperCase(),
      defaultCurrency: String(input.defaultCurrency ?? prev?.defaultCurrency ?? 'USD')
        .trim()
        .toUpperCase(),
      currencySymbol: String(input.currencySymbol ?? prev?.currencySymbol ?? '')
        .trim(),
      steamLanguage: String(input.steamLanguage ?? prev?.steamLanguage ?? 'en').trim().toLowerCase(),
      enabled: input.enabled !== undefined ? Boolean(input.enabled) : (prev?.enabled ?? true),
      sortOrder: input.sortOrder !== undefined ? Number(input.sortOrder) : (prev?.sortOrder ?? 500),
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
    };
    if (!/^[A-Z]{2}$/.test(row.steamCc)) throw new Error('steamCc must be 2 letters');
    if (!/^[A-Z]{3}$/.test(row.defaultCurrency)) throw new Error('defaultCurrency must be 3 letters');
    if (!row.currencySymbol) {
      row.currencySymbol = defaultCurrencySymbol(row.defaultCurrency);
    }
    await ref.set(row);
    return row;
  }

  async setEnabled(countryCode: string, enabled: boolean): Promise<void> {
    const c = String(countryCode).trim().toUpperCase();
    await this.db
      .collection(COL)
      .doc(c)
      .set({ enabled, updatedAt: admin.firestore.Timestamp.now() }, { merge: true });
  }
}
