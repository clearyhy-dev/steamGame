import admin from 'firebase-admin';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getFirestore } from '../../config/firebase';
import type {
  GameCatalogDoc,
  GameCountryPriceBucket,
  GgOfficialPricesSnapshot,
  GgDetailSnapshot,
  ItadDetailSnapshot,
  RegionalSourcePriceSnapshot,
  WorthBuyStoredSnapshot,
} from './game-catalog.repository';
import type { DealSource } from './deal-source.types';
import type { Env } from '../../config/env';
import { loadEnv } from '../../config/env';
import { logger } from '../../utils/logger';
import {
  assertObjectStorageConfigured,
  listDiscountOfferKeysForAppid,
  readDiscountOfferDoc,
  writeDiscountOfferDoc,
} from '../../cache/discount-offers-object-storage';

/** 仅读 catalog，避免与 `GameCatalogRepository` 形成不必要耦合 */
export type CatalogByAppidReader = {
  getByAppid(appid: string): Promise<GameCatalogDoc | null>;
};

const COLLECTION = 'game_discount_offers';

/** 管理员手工 / 联盟链等，键为 dealId */
export type GameExtraDealLinkDoc = {
  source: DealSource;
  url: string;
  isAffiliate?: boolean;
  isActive?: boolean;
  priority?: number;
  countryCode?: string;
  currency?: string;
  originalPrice?: number;
  finalPrice?: number;
  discountPercent?: number;
  hotnessScore?: number;
  offerStatus?: 'active' | 'stale' | 'invalid';
  invalidReason?: string;
  startAt?: admin.firestore.Timestamp | null;
  endAt?: admin.firestore.Timestamp | null;
  lastCheckedAt?: admin.firestore.Timestamp;
  lastPriceSyncAt?: admin.firestore.Timestamp;
};

/**
 * 单表存储：一国 × 一游戏的完整多渠道折扣镜像（链接、价格、ITAD/GG 扩展、值得买）。
 * 文档 ID：`{appid}__{CC}`（如 `730__US`）。
 */
export type GameDiscountCountryDoc = GameCountryPriceBucket & {
  appid: string;
  updatedAt: admin.firestore.Timestamp;
  createdAt: admin.firestore.Timestamp;
  extraDeals?: Record<string, GameExtraDealLinkDoc>;
};

const MAIN_SOURCES = ['steam', 'isthereanydeal', 'ggdeals', 'cheapshark'] as const;
type MainSource = (typeof MAIN_SOURCES)[number];

function bucketDocId(appid: string, businessCountryCode: string): string {
  const key = String(appid ?? '').trim();
  const cc = String(businessCountryCode ?? '')
    .trim()
    .toUpperCase();
  return `${key}__${cc}`;
}

type MergeCountryInput = {
  providerCodes?: {
    steamCc?: string;
    itadCountry?: string;
    ggDealsRegion?: string;
    cheapsharkCountry?: string;
  };
  steam?: RegionalSourcePriceSnapshot;
  isthereanydeal?: RegionalSourcePriceSnapshot;
  ggdeals?: RegionalSourcePriceSnapshot;
  cheapshark?: RegionalSourcePriceSnapshot;
  itadDetail?: ItadDetailSnapshot;
  ggDetail?: GgDetailSnapshot;
  worthBuy?: WorthBuyStoredSnapshot;
  markFullSync?: boolean;
};

function buildMergedDiscountCountryDoc(
  existing: GameDiscountCountryDoc | null,
  appid: string,
  cc: string,
  input: MergeCountryInput,
  now: admin.firestore.Timestamp,
): GameDiscountCountryDoc {
  const key = String(appid ?? '').trim();
  const prev: GameCountryPriceBucket = existing
    ? {
        countryCode: cc,
        steamCc: existing.steamCc,
        itadCountry: existing.itadCountry,
        ggDealsRegion: existing.ggDealsRegion,
        cheapsharkCountry: existing.cheapsharkCountry,
        steam: existing.steam,
        isthereanydeal: existing.isthereanydeal,
        ggdeals: existing.ggdeals,
        cheapshark: existing.cheapshark,
        itadDetail: existing.itadDetail,
        ggDetail: existing.ggDetail,
        worthBuy: existing.worthBuy,
        lastFullSyncAt: existing.lastFullSyncAt,
      }
    : { countryCode: cc };
  const next: GameCountryPriceBucket = { ...prev, countryCode: cc };
  if (input.providerCodes) {
    const p = input.providerCodes;
    if (p.steamCc) next.steamCc = p.steamCc;
    if (p.itadCountry) next.itadCountry = p.itadCountry;
    if (p.ggDealsRegion) next.ggDealsRegion = p.ggDealsRegion;
    if (p.cheapsharkCountry) next.cheapsharkCountry = p.cheapsharkCountry;
  }
  const mergeSrc = (field: MainSource, patch?: RegionalSourcePriceSnapshot) => {
    if (!patch) return;
    const old = prev[field];
    next[field] = {
      ...old,
      ...patch,
      syncedAt: patch.syncedAt ?? now,
    };
  };
  mergeSrc('steam', input.steam);
  mergeSrc('isthereanydeal', input.isthereanydeal);
  mergeSrc('ggdeals', input.ggdeals);
  mergeSrc('cheapshark', input.cheapshark);
  if (input.itadDetail) next.itadDetail = input.itadDetail;
  if (input.ggDetail) next.ggDetail = input.ggDetail;
  if (input.worthBuy) next.worthBuy = input.worthBuy;
  if (input.markFullSync) next.lastFullSyncAt = now;

  return {
    ...next,
    appid: key,
    extraDeals: existing?.extraDeals,
    updatedAt: now,
    createdAt: existing?.createdAt ?? now,
  };
}

export class GameDiscountOffersRepository {
  private db = getFirestore();

  constructor(private readonly env?: Env) {}

  private resolveEnv(): Env {
    return this.env ?? loadEnv();
  }

  private persistDiscountOffersInObjectStorage(): boolean {
    return this.resolveEnv().discountOffersPersistence === 'object_storage';
  }

  collectionRef() {
    return this.db.collection(COLLECTION);
  }

  async mergeCountryPriceBucket(appid: string, businessCountryCode: string, input: MergeCountryInput): Promise<void> {
    const key = String(appid ?? '').trim();
    const cc = String(businessCountryCode ?? '')
      .trim()
      .toUpperCase();
    if (!key || !/^[A-Z]{2}$/.test(cc)) return;
    const now = admin.firestore.Timestamp.now();

    if (this.persistDiscountOffersInObjectStorage()) {
      const env = this.resolveEnv();
      assertObjectStorageConfigured(env);
      const existing = await readDiscountOfferDoc(env, key, cc);
      const payload = buildMergedDiscountCountryDoc(existing, key, cc, input, now);
      await writeDiscountOfferDoc(env, payload);
      return;
    }

    const ref = this.collectionRef().doc(bucketDocId(key, cc));
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists ? (snap.data() as GameDiscountCountryDoc) : null;
      const payload = buildMergedDiscountCountryDoc(existing, key, cc, input, now);
      tx.set(ref, payload, { merge: true });
    });
  }

  async getBucket(appid: string, businessCountryCode: string): Promise<GameDiscountCountryDoc | null> {
    const key = String(appid ?? '').trim();
    const cc = String(businessCountryCode ?? '')
      .trim()
      .toUpperCase();
    if (!key || !/^[A-Z]{2}$/.test(cc)) return null;
    if (this.persistDiscountOffersInObjectStorage()) {
      return readDiscountOfferDoc(this.resolveEnv(), key, cc);
    }
    const snap = await this.collectionRef().doc(bucketDocId(key, cc)).get();
    if (!snap.exists) return null;
    return snap.data() as GameDiscountCountryDoc;
  }

  async listBucketsForAppid(appid: string): Promise<GameDiscountCountryDoc[]> {
    const key = String(appid ?? '').trim();
    if (!key) return [];
    if (this.persistDiscountOffersInObjectStorage()) {
      const env = this.resolveEnv();
      const keys = await listDiscountOfferKeysForAppid(env, key);
      const out: GameDiscountCountryDoc[] = [];
      await Promise.all(
        keys.map(async (objectKey) => {
          const tail = objectKey.split('/').pop() ?? '';
          const m = /^(.+)__([A-Z]{2})\.json$/i.exec(tail);
          if (!m || m[1] !== key) return;
          const doc = await readDiscountOfferDoc(env, key, m[2].toUpperCase());
          if (doc) out.push(doc);
        }),
      );
      return out;
    }
    const snap = await this.collectionRef().where('appid', '==', key).get();
    return snap.docs.map((d: QueryDocumentSnapshot) => d.data() as GameDiscountCountryDoc);
  }

  /** 点读多国桶（每国 1 read），用于公开详情页降本；去重并行 get */
  async getBucketsForAppidAndCountries(
    appid: string,
    businessCountryCodes: string[],
  ): Promise<GameDiscountCountryDoc[]> {
    const key = String(appid ?? '').trim();
    if (!key) return [];
    const uniq = Array.from(
      new Set(
        businessCountryCodes
          .map((c) => String(c ?? '').trim().toUpperCase())
          .filter((c) => /^[A-Z]{2}$/.test(c)),
      ),
    );
    if (uniq.length === 0) return [];
    const rows = await Promise.all(uniq.map((cc) => this.getBucket(key, cc)));
    return rows.filter((x): x is GameDiscountCountryDoc => x != null);
  }

  /** 批量拉取多游戏的全部国家桶（每批 `appid in` 最多 10 条） */
  async listBucketsForAppids(appids: string[]): Promise<GameDiscountCountryDoc[]> {
    const uniq = Array.from(new Set(appids.map((x) => String(x ?? '').trim()).filter(Boolean)));
    if (uniq.length === 0) return [];
    if (this.persistDiscountOffersInObjectStorage()) {
      const env = this.resolveEnv();
      const concurrency = 8;
      const out: GameDiscountCountryDoc[] = [];
      for (let i = 0; i < uniq.length; i += concurrency) {
        const chunk = uniq.slice(i, i + concurrency);
        const parts = await Promise.all(chunk.map((aid) => this.listBucketsForAppid(aid)));
        for (const p of parts) out.push(...p);
      }
      return out;
    }
    const out: GameDiscountCountryDoc[] = [];
    const chunkSize = 10;
    for (let i = 0; i < uniq.length; i += chunkSize) {
      const part = uniq.slice(i, i + chunkSize);
      const snap = await this.collectionRef().where('appid', 'in', part).get();
      for (const d of snap.docs) {
        out.push(d.data() as GameDiscountCountryDoc);
      }
    }
    return out;
  }

  /** 去掉运营侧字段，得到与 API `byCountry[cc]` 一致的分桶结构 */
  countryBucketFromDoc(doc: GameDiscountCountryDoc): GameCountryPriceBucket {
    const { appid: _a, updatedAt: _u, createdAt: _c, extraDeals: _e, ...rest } = doc;
    return rest as GameCountryPriceBucket;
  }

  /** 供 API 序列化：去掉运营字段，形状与 `byCountry` 单国值一致 */
  toByCountryMap(buckets: GameDiscountCountryDoc[]): Record<string, GameCountryPriceBucket> {
    const out: Record<string, GameCountryPriceBucket> = {};
    for (const b of buckets) {
      const cc = String(b.countryCode ?? '')
        .trim()
        .toUpperCase();
      if (!/^[A-Z]{2}$/.test(cc)) continue;
      const { appid: _a, updatedAt: _u, createdAt: _c, extraDeals: _e, ...rest } = b;
      out[cc] = rest as GameCountryPriceBucket;
    }
    return out;
  }

  async mergeExtraDeal(
    appid: string,
    businessCountryCode: string,
    dealId: string,
    input: GameExtraDealLinkDoc,
  ): Promise<void> {
    const key = String(appid ?? '').trim();
    const cc = String(businessCountryCode ?? '')
      .trim()
      .toUpperCase();
    const id = String(dealId ?? '').trim();
    if (!key || !/^[A-Z]{2}$/.test(cc) || !id) return;
    const now = admin.firestore.Timestamp.now();

    if (this.persistDiscountOffersInObjectStorage()) {
      const env = this.resolveEnv();
      assertObjectStorageConfigured(env);
      const existing = await readDiscountOfferDoc(env, key, cc);
      const extra = { ...(existing?.extraDeals ?? {}) };
      extra[id] = { ...input, countryCode: input.countryCode ?? cc };
      const base: GameDiscountCountryDoc =
        existing ??
        ({
          countryCode: cc,
          appid: key,
          extraDeals: {},
          updatedAt: now,
          createdAt: now,
        } as GameDiscountCountryDoc);
      const payload: GameDiscountCountryDoc = {
        ...base,
        extraDeals: extra,
        updatedAt: now,
      };
      await writeDiscountOfferDoc(env, payload);
      return;
    }

    const ref = this.collectionRef().doc(bucketDocId(key, cc));
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const existing = snap.exists ? (snap.data() as GameDiscountCountryDoc) : null;
      const extra = { ...(existing?.extraDeals ?? {}) };
      extra[id] = { ...input, countryCode: input.countryCode ?? cc };
      const baseBucket: Partial<GameDiscountCountryDoc> = existing
        ? {
            countryCode: cc,
            steamCc: existing.steamCc,
            itadCountry: existing.itadCountry,
            ggDealsRegion: existing.ggDealsRegion,
            cheapsharkCountry: existing.cheapsharkCountry,
            steam: existing.steam,
            isthereanydeal: existing.isthereanydeal,
            ggdeals: existing.ggdeals,
            cheapshark: existing.cheapshark,
            itadDetail: existing.itadDetail,
            ggDetail: existing.ggDetail,
            worthBuy: existing.worthBuy,
            lastFullSyncAt: existing.lastFullSyncAt,
          }
        : { countryCode: cc };
      tx.set(
        ref,
        {
          ...baseBucket,
          appid: key,
          extraDeals: extra,
          updatedAt: now,
          createdAt: existing?.createdAt ?? now,
        } as GameDiscountCountryDoc,
        { merge: true },
      );
    });
  }

  async deleteNextBatch(limit = 500): Promise<number> {
    if (this.persistDiscountOffersInObjectStorage()) {
      logger.warn(
        '[game_discount_offers] deleteNextBatch skipped (DISCOUNT_OFFERS_PERSISTENCE=object_storage); purge objects via GCS/R2 tooling or lifecycle rules.',
      );
      return 0;
    }
    const lim = Math.max(1, Math.min(Math.trunc(limit) || 500, 500));
    const snap = await this.collectionRef().limit(lim).get();
    if (snap.empty) return 0;
    let batch = this.db.batch();
    let ops = 0;
    for (const d of snap.docs) {
      batch.delete(d.ref);
      ops += 1;
      if (ops >= 450) {
        await batch.commit();
        batch = this.db.batch();
        ops = 0;
      }
    }
    if (ops > 0) await batch.commit();
    return snap.size;
  }

  async deleteAll(maxTotal = 500_000): Promise<{ deleted: number }> {
    if (this.persistDiscountOffersInObjectStorage()) {
      logger.warn('[game_discount_offers] deleteAll skipped (object_storage)');
      return { deleted: 0 };
    }
    let cap = Math.trunc(Number(maxTotal));
    if (!Number.isFinite(cap) || cap < 0) cap = 500_000;
    cap = Math.min(cap, 2_000_000);
    let deleted = 0;
    while (deleted < cap) {
      const step = await this.deleteNextBatch(Math.min(500, cap - deleted));
      if (step === 0) break;
      deleted += step;
    }
    return { deleted };
  }

  async markStaleOlderThan(ttlHours: number, maxScan = 1500): Promise<{ scanned: number; staleMarked: number }> {
    if (this.persistDiscountOffersInObjectStorage()) {
      logger.warn('[game_discount_offers] markStaleOlderThan skipped (object_storage)');
      return { scanned: 0, staleMarked: 0 };
    }
    const ttlMs = Math.max(1, Number(ttlHours || 6)) * 3600 * 1000;
    const cutoff = Date.now() - ttlMs;
    const snap = await this.collectionRef()
      .orderBy('updatedAt', 'asc')
      .limit(Math.max(1, Math.min(maxScan, 5000)))
      .get();
    let scanned = 0;
    let staleMarked = 0;
    let batch = this.db.batch();
    let opCount = 0;
    const now = admin.firestore.Timestamp.now();
    for (const d of snap.docs) {
      scanned += 1;
      const row = d.data() as GameDiscountCountryDoc;
      const updates: Record<string, unknown> = { updatedAt: now };
      let touched = false;
      for (const field of MAIN_SOURCES) {
        const sub = row[field];
        if (!sub?.lastPriceSyncAt) continue;
        const active = sub.isActive !== false && (sub.offerStatus ?? 'active') !== 'invalid';
        if (!active) continue;
        const last = sub.lastPriceSyncAt.toDate().getTime();
        if (last <= 0 || last >= cutoff) continue;
        updates[field] = { ...sub, offerStatus: 'stale' };
        touched = true;
        staleMarked += 1;
      }
      if (touched) {
        batch.update(d.ref, updates);
        opCount += 1;
        if (opCount >= 450) {
          await batch.commit();
          batch = this.db.batch();
          opCount = 0;
        }
      }
    }
    if (opCount > 0) await batch.commit();
    return { scanned, staleMarked };
  }

  /**
   * 按 documentId 分页扫描一国桶文档，移除 invalid 主源片段 / extraDeals。
   * @returns touched 本页实际执行了 update 的文档数；无更多文档时 hasMore=false
   */
  async deleteInvalidFragmentsPage(
    limit = 500,
    startAfter?: QueryDocumentSnapshot,
  ): Promise<{ touched: number; hasMore: boolean; lastDoc?: QueryDocumentSnapshot }> {
    if (this.persistDiscountOffersInObjectStorage()) {
      logger.warn('[game_discount_offers] deleteInvalidFragmentsPage skipped (object_storage)');
      return { touched: 0, hasMore: false };
    }
    const lim = Math.max(1, Math.min(Math.trunc(limit) || 500, 500));
    let q = this.collectionRef().orderBy(admin.firestore.FieldPath.documentId()).limit(lim);
    if (startAfter) q = q.startAfter(startAfter);
    const snap = await q.get();
    if (snap.empty) return { touched: 0, hasMore: false };
    let batch = this.db.batch();
    let ops = 0;
    let touched = 0;
    const now = admin.firestore.Timestamp.now();
    for (const d of snap.docs) {
      const data = d.data() as GameDiscountCountryDoc;
      const updates: Record<string, unknown> = { updatedAt: now };
      let docTouched = false;
      for (const field of MAIN_SOURCES) {
        const sub = data[field];
        if (sub && (sub.offerStatus ?? 'active') === 'invalid') {
          updates[field] = admin.firestore.FieldValue.delete();
          docTouched = true;
        }
      }
      if (data.extraDeals && Object.keys(data.extraDeals).length > 0) {
        const nextExtra = { ...data.extraDeals };
        for (const [eid, erow] of Object.entries(nextExtra)) {
          if ((erow.offerStatus ?? 'active') === 'invalid') {
            delete nextExtra[eid];
            docTouched = true;
          }
        }
        if (Object.keys(nextExtra).length === 0) {
          updates.extraDeals = admin.firestore.FieldValue.delete();
        } else {
          updates.extraDeals = nextExtra;
        }
      }
      if (docTouched) {
        batch.update(d.ref, updates);
        touched += 1;
        ops += 1;
        if (ops >= 450) {
          await batch.commit();
          batch = this.db.batch();
          ops = 0;
        }
      }
    }
    if (ops > 0) await batch.commit();
    const lastDoc = snap.docs[snap.docs.length - 1];
    return { touched, hasMore: snap.size >= lim, lastDoc };
  }

  /**
   * GG 发现扫描：从本集合读 `ggDetail`，再拼回 `GameCatalogDoc` 列表。
   */
  async scanGgDiscoveryAgainstCatalog(
    catalog: CatalogByAppidReader,
    params: {
      insightCc: string;
      page: number;
      pageSize: number;
      sortBy?: 'online_desc' | 'updated_desc' | 'discount_desc';
      ggNearHistorical?: boolean;
      appid?: string;
      keyword?: string;
      minDiscountPercent?: number;
      hasDetailSynced?: boolean;
    },
  ): Promise<{ rows: GameCatalogDoc[]; total: number }> {
    const cc = String(params.insightCc ?? '')
      .trim()
      .toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return { rows: [], total: 0 };
    const page = Math.max(1, Math.trunc(params.page));
    const pageSize = Math.max(1, Math.min(params.pageSize, 500));
    const sortBy = params.sortBy ?? 'online_desc';
    const needAny = !!params.ggNearHistorical;
    if (!needAny) return { rows: [], total: 0 };
    if (this.persistDiscountOffersInObjectStorage()) {
      logger.warn('[game_discount_offers] scanGgDiscoveryAgainstCatalog not supported on object_storage');
      return { rows: [], total: 0 };
    }

    const nearHistorical = (p: GgOfficialPricesSnapshot | undefined, ratio: number): boolean => {
      if (!p) return false;
      const hit = (cur?: number, hist?: number) =>
        typeof cur === 'number' && typeof hist === 'number' && hist > 0 && cur <= hist * ratio;
      return hit(p.currentRetail, p.historicalRetail) || hit(p.currentKeyshops, p.historicalKeyshops);
    };

    const matchedAppids = new Set<string>();
    let last: QueryDocumentSnapshot | undefined;
    const pageWalk = 400;
    for (;;) {
      let q = this.collectionRef().orderBy(admin.firestore.FieldPath.documentId()).limit(pageWalk);
      if (last) q = q.startAfter(last);
      const snap = await q.get();
      if (snap.empty) break;
      for (const d of snap.docs) {
        const data = d.data() as GameDiscountCountryDoc;
        if (String(data.countryCode ?? '').toUpperCase() !== cc) continue;
        const g = data.ggDetail;
        if (!g) continue;
        if (params.ggNearHistorical && !nearHistorical(g.prices, 1.05)) continue;
        matchedAppids.add(data.appid);
      }
      last = snap.docs[snap.docs.length - 1];
      if (snap.size < pageWalk) break;
    }

    const catalogRows: GameCatalogDoc[] = [];
    for (const appid of matchedAppids) {
      const appidF = String(params.appid ?? '').trim();
      if (appidF && appid !== appidF) continue;
      const doc = await catalog.getByAppid(appid);
      if (!doc) continue;
      const keyword = String(params.keyword ?? '').trim().toLowerCase();
      if (keyword && !doc.name.toLowerCase().includes(keyword) && !doc.appid.includes(keyword)) continue;
      if (typeof params.minDiscountPercent === 'number' && (doc.discountPercent ?? 0) < params.minDiscountPercent)
        continue;
      if (typeof params.hasDetailSynced === 'boolean') {
        const synced = !!doc.lastDetailSyncAt;
        if (params.hasDetailSynced !== synced) continue;
      }
      catalogRows.push(doc);
    }

    if (sortBy === 'discount_desc') {
      catalogRows.sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0) || a.appid.localeCompare(b.appid));
    } else if (sortBy === 'updated_desc') {
      catalogRows.sort((a, b) => {
        const tb = b.updatedAt?.toMillis?.() ?? 0;
        const ta = a.updatedAt?.toMillis?.() ?? 0;
        if (tb !== ta) return tb - ta;
        return a.appid.localeCompare(b.appid);
      });
    } else {
      catalogRows.sort((a, b) => (b.currentPlayers ?? 0) - (a.currentPlayers ?? 0) || a.appid.localeCompare(b.appid));
    }

    const total = catalogRows.length;
    const slice = catalogRows.slice((page - 1) * pageSize, (page - 1) * pageSize + pageSize);
    return { rows: slice, total };
  }
}
