import admin from 'firebase-admin';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getFirestore } from '../../config/firebase';
import type { Env } from '../../config/env';
import { randomUUID } from 'node:crypto';
import type { RegionalSourcePriceSnapshot } from './game-catalog.repository';
import type { DealSource } from './deal-source.types';
import {
  GameDiscountOffersRepository,
  type GameDiscountCountryDoc,
  type GameExtraDealLinkDoc,
} from './game-discount-offers.repository';
import { recordPriceSync } from '../../cache/price-sync-index';

export type { DealSource } from './deal-source.types';

export type GameDealLinkDoc = {
  dealId: string;
  appid: string;
  source: DealSource;
  url: string;
  isAffiliate: boolean;
  isActive: boolean;
  priority: number;
  countryCode?: string;
  startAt?: admin.firestore.Timestamp | null;
  endAt?: admin.firestore.Timestamp | null;
  currency?: string;
  originalPrice?: number;
  finalPrice?: number;
  discountPercent?: number;
  hotnessScore?: number;
  offerStatus?: 'active' | 'stale' | 'invalid';
  invalidReason?: string;
  lastCheckedAt?: admin.firestore.Timestamp;
  lastPriceSyncAt?: admin.firestore.Timestamp;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
};

/** 历史集合，当前逻辑已迁到 `game_discount_offers`；仅维护任务物理清空用 */
const LEGACY_DEAL_LINKS_COLLECTION = 'game_deal_links';

const MAIN_DEAL_SOURCES = ['steam', 'isthereanydeal', 'ggdeals', 'cheapshark'] as const;
type MainDealSource = (typeof MAIN_DEAL_SOURCES)[number];

function isMainDealSource(s: DealSource): s is MainDealSource {
  return (MAIN_DEAL_SOURCES as readonly string[]).includes(s);
}

function sourceToBucketKey(source: MainDealSource): MainDealSource {
  return source;
}

function defaultDealId(appid: string, source: DealSource, cc: string): string {
  return `${String(appid).trim()}_${source}_${String(cc || 'US').toUpperCase()}`.toLowerCase();
}

function toTsOrNull(v: unknown): admin.firestore.Timestamp | null | undefined {
  if (v === null) return null;
  if (v === undefined || v === '') return undefined;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return undefined;
  return admin.firestore.Timestamp.fromDate(d);
}

function omitUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
}

function snapshotToDealDoc(
  appid: string,
  countryCode: string,
  source: DealSource,
  snap: RegionalSourcePriceSnapshot,
  meta: { dealId: string; createdAt: admin.firestore.Timestamp; updatedAt: admin.firestore.Timestamp },
): GameDealLinkDoc {
  const dealId = snap.dealId || meta.dealId;
  return {
    dealId,
    appid,
    source,
    url: String(snap.url ?? ''),
    isAffiliate: snap.isAffiliate ?? source === 'affiliate',
    isActive: snap.isActive !== false,
    priority: Math.max(0, Math.min(Number(snap.priority ?? 100), 9999)),
    countryCode,
    startAt: snap.startAt ?? null,
    endAt: snap.endAt ?? null,
    currency: snap.currency,
    originalPrice: snap.originalPrice,
    finalPrice: snap.finalPrice,
    discountPercent: snap.discountPercent,
    hotnessScore: snap.hotnessScore,
    offerStatus: snap.offerStatus,
    invalidReason: snap.invalidReason,
    lastCheckedAt: snap.lastCheckedAt,
    lastPriceSyncAt: snap.lastPriceSyncAt ?? snap.syncedAt,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

function extraRowToDealDoc(
  appid: string,
  fallbackCc: string,
  dealId: string,
  erow: GameExtraDealLinkDoc,
  meta: { createdAt: admin.firestore.Timestamp; updatedAt: admin.firestore.Timestamp },
): GameDealLinkDoc {
  const cc = String(erow.countryCode ?? fallbackCc)
    .trim()
    .toUpperCase();
  return {
    dealId,
    appid,
    source: erow.source,
    url: String(erow.url ?? ''),
    isAffiliate: erow.isAffiliate ?? false,
    isActive: erow.isActive !== false,
    priority: Math.max(0, Math.min(Number(erow.priority ?? 200), 9999)),
    countryCode: cc || 'US',
    startAt: erow.startAt ?? null,
    endAt: erow.endAt ?? null,
    currency: erow.currency,
    originalPrice: erow.originalPrice,
    finalPrice: erow.finalPrice,
    discountPercent: erow.discountPercent,
    hotnessScore: erow.hotnessScore,
    offerStatus: erow.offerStatus,
    invalidReason: erow.invalidReason,
    lastCheckedAt: erow.lastCheckedAt,
    lastPriceSyncAt: erow.lastPriceSyncAt,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
  };
}

function flattenBucketsToDeals(docs: GameDiscountCountryDoc[]): GameDealLinkDoc[] {
  const out: GameDealLinkDoc[] = [];
  for (const doc of docs) {
    const appid = doc.appid;
    const cc = String(doc.countryCode ?? 'US')
      .trim()
      .toUpperCase();
    const meta = { createdAt: doc.createdAt, updatedAt: doc.updatedAt };
    for (const src of MAIN_DEAL_SOURCES) {
      const snap = doc[src] as RegionalSourcePriceSnapshot | undefined;
      if (!snap) continue;
      const hasUrl = typeof snap.url === 'string' && snap.url.trim().length > 0;
      const hasErr = typeof snap.error === 'string' && snap.error.length > 0;
      const invalid = (snap.offerStatus ?? 'active') === 'invalid';
      if (!hasUrl && !hasErr && !invalid) continue;
      const did = snap.dealId || defaultDealId(appid, src, cc);
      out.push(snapshotToDealDoc(appid, cc, src, snap, { dealId: did, ...meta }));
    }
    const extra = doc.extraDeals;
    if (extra) {
      for (const [eid, erow] of Object.entries(extra)) {
        out.push(extraRowToDealDoc(appid, cc, eid, erow, meta));
      }
    }
  }
  return out.sort((a, b) => a.priority - b.priority);
}

export class GameDealLinkRepository {
  private offers: GameDiscountOffersRepository;

  constructor(env: Env) {
    this.offers = new GameDiscountOffersRepository(env);
  }

  isActiveNow(link: GameDealLinkDoc, nowMs = Date.now()): boolean {
    if (!link.isActive) return false;
    if ((link.offerStatus ?? 'active') === 'invalid') return false;
    const startMs = link.startAt ? link.startAt.toDate().getTime() : -Infinity;
    const endMs = link.endAt ? link.endAt.toDate().getTime() : Infinity;
    return nowMs >= startMs && nowMs <= endMs;
  }

  async listByAppid(appid: string): Promise<GameDealLinkDoc[]> {
    const buckets = await this.offers.listBucketsForAppid(appid);
    return flattenBucketsToDeals(buckets);
  }

  async listActiveByAppids(appids: string[]): Promise<Map<string, GameDealLinkDoc[]>> {
    const buckets = await this.offers.listBucketsForAppids(
      Array.from(new Set(appids.map((x) => String(x || '').trim()).filter(Boolean))),
    );
    return this.buildActiveDealMapFromBuckets(buckets);
  }

  /** 由已拉取的折扣桶构建 active deal 索引（避免重复读 MinIO） */
  buildActiveDealMapFromBuckets(buckets: GameDiscountCountryDoc[]): Map<string, GameDealLinkDoc[]> {
    const out = new Map<string, GameDealLinkDoc[]>();
    const nowMs = Date.now();
    const flat = flattenBucketsToDeals(buckets);
    for (const row of flat) {
      if (!this.isActiveNow(row, nowMs)) continue;
      const arr = out.get(row.appid) ?? [];
      arr.push(row);
      out.set(row.appid, arr);
    }
    for (const [aid, rows] of out.entries()) {
      out.set(aid, rows.sort((a, b) => a.priority - b.priority));
    }
    return out;
  }

  async upsertForApp(
    appid: string,
    input: {
      dealId?: string;
      source: DealSource;
      url: string;
      isAffiliate?: boolean;
      isActive?: boolean;
      priority?: number;
      countryCode?: string;
      startAt?: string | null;
      endAt?: string | null;
      currency?: string;
      originalPrice?: number;
      finalPrice?: number;
      discountPercent?: number;
      hotnessScore?: number;
      offerStatus?: 'active' | 'stale' | 'invalid';
      invalidReason?: string;
      lastCheckedAt?: admin.firestore.Timestamp;
      lastPriceSyncAt?: admin.firestore.Timestamp;
    },
  ): Promise<GameDealLinkDoc> {
    const now = admin.firestore.Timestamp.now();
    const cc = String(input.countryCode ?? '').trim().toUpperCase() || 'US';
    let result: GameDealLinkDoc;

    if (isMainDealSource(input.source)) {
      const dealId = String(input.dealId ?? '').trim() || defaultDealId(appid, input.source, cc);
      const patch = omitUndefined({
        url: input.url.trim(),
        currency: input.currency,
        originalPrice: input.originalPrice,
        finalPrice: input.finalPrice,
        discountPercent: input.discountPercent,
        syncedAt: now,
        dealId,
        priority: Math.max(0, Math.min(Number(input.priority ?? 100), 9999)),
        isAffiliate: input.isAffiliate ?? false,
        isActive: input.isActive ?? true,
        offerStatus: input.offerStatus,
        invalidReason: input.invalidReason,
        lastCheckedAt: input.lastCheckedAt,
        lastPriceSyncAt: input.lastPriceSyncAt ?? now,
        startAt: toTsOrNull(input.startAt),
        endAt: toTsOrNull(input.endAt),
        hotnessScore: input.hotnessScore,
      } as RegionalSourcePriceSnapshot);

      const key = sourceToBucketKey(input.source);
      await this.offers.mergeCountryPriceBucket(appid, cc, { [key]: patch });

      const bucket = await this.offers.getBucket(appid, cc);
      const snap = bucket?.[key] as RegionalSourcePriceSnapshot | undefined;
      const createdAt = bucket?.createdAt ?? now;
      const updatedAt = bucket?.updatedAt ?? now;
      if (snap) {
        result = snapshotToDealDoc(appid, cc, input.source, snap, { dealId, createdAt, updatedAt });
      } else {
        result = {
          dealId,
          appid,
          source: input.source,
          url: input.url.trim(),
          isAffiliate: input.isAffiliate ?? false,
          isActive: input.isActive ?? true,
          priority: Math.max(0, Math.min(Number(input.priority ?? 100), 9999)),
          countryCode: cc,
          startAt: toTsOrNull(input.startAt) ?? null,
          endAt: toTsOrNull(input.endAt) ?? null,
          currency: input.currency,
          originalPrice: input.originalPrice,
          finalPrice: input.finalPrice,
          discountPercent: input.discountPercent,
          hotnessScore: input.hotnessScore,
          offerStatus: input.offerStatus,
          invalidReason: input.invalidReason,
          lastCheckedAt: input.lastCheckedAt,
          lastPriceSyncAt: input.lastPriceSyncAt ?? now,
          createdAt,
          updatedAt,
        };
      }
    } else {

      const dealId = String(input.dealId ?? '').trim() || randomUUID();
      const extraPayload: GameExtraDealLinkDoc = omitUndefined({
      source: input.source,
      url: input.url.trim(),
      isAffiliate: input.isAffiliate ?? input.source === 'affiliate',
      isActive: input.isActive ?? true,
      priority: Math.max(0, Math.min(Number(input.priority ?? 100), 9999)),
      countryCode: cc,
      currency: input.currency,
      originalPrice: input.originalPrice,
      finalPrice: input.finalPrice,
      discountPercent: input.discountPercent,
      hotnessScore: input.hotnessScore,
      offerStatus: input.offerStatus,
      invalidReason: input.invalidReason,
      startAt: toTsOrNull(input.startAt),
      endAt: toTsOrNull(input.endAt),
      lastCheckedAt: input.lastCheckedAt,
      lastPriceSyncAt: input.lastPriceSyncAt ?? now,
      } as GameExtraDealLinkDoc);

      await this.offers.mergeExtraDeal(appid, cc, dealId, extraPayload);
      const bucket = await this.offers.getBucket(appid, cc);
      const erow = bucket?.extraDeals?.[dealId];
      const createdAt = bucket?.createdAt ?? now;
      const updatedAt = bucket?.updatedAt ?? now;
      if (erow) {
        result = extraRowToDealDoc(appid, cc, dealId, erow, { createdAt, updatedAt });
      } else {
        result = {
          dealId,
          appid,
          source: input.source,
          url: input.url.trim(),
          isAffiliate: input.isAffiliate ?? input.source === 'affiliate',
          isActive: input.isActive ?? true,
          priority: Math.max(0, Math.min(Number(input.priority ?? 100), 9999)),
          countryCode: cc,
          startAt: toTsOrNull(input.startAt) ?? null,
          endAt: toTsOrNull(input.endAt) ?? null,
          currency: input.currency,
          originalPrice: input.originalPrice,
          finalPrice: input.finalPrice,
          discountPercent: input.discountPercent,
          hotnessScore: input.hotnessScore,
          offerStatus: input.offerStatus,
          invalidReason: input.invalidReason,
          lastCheckedAt: input.lastCheckedAt,
          lastPriceSyncAt: input.lastPriceSyncAt ?? now,
          createdAt,
          updatedAt,
        };
      }
    }

    void recordPriceSync(appid, { countryCode: cc, source: input.source }).catch(() => undefined);
    return result;
  }

  /**
   * 清理 `game_discount_offers` 内 invalid 片段（分页扫描）；返回值表示本轮有改动的文档数。
   */
  async deleteInvalidDealLinksBatch(limit = 500): Promise<number> {
    const r = await this.offers.deleteInvalidFragmentsPage(limit);
    return r.touched;
  }

  async deleteDealLinksNextBatch(limit = 500): Promise<number> {
    return this.offers.deleteNextBatch(limit);
  }

  /** 清空 `game_discount_offers`。 */
  async deleteAllDealLinks(maxTotal = 500_000): Promise<{ deleted: number }> {
    return this.offers.deleteAll(maxTotal);
  }

  /**
   * 分页物理删除遗留集合 `game_deal_links` 中的文档（新数据均在 `game_discount_offers`）。
   */
  async deleteLegacyGameDealLinksCollection(maxTotal = 500_000): Promise<{ deleted: number }> {
    const db = getFirestore();
    let cap = Math.trunc(Number(maxTotal));
    if (!Number.isFinite(cap) || cap < 0) cap = 500_000;
    cap = Math.min(cap, 2_000_000);
    let deleted = 0;
    while (deleted < cap) {
      const lim = Math.max(1, Math.min(500, cap - deleted));
      const snap = await db.collection(LEGACY_DEAL_LINKS_COLLECTION).limit(lim).get();
      if (snap.empty) break;
      let batch = db.batch();
      let ops = 0;
      for (const d of snap.docs) {
        batch.delete(d.ref);
        ops += 1;
        deleted += 1;
        if (ops >= 450) {
          await batch.commit();
          batch = db.batch();
          ops = 0;
        }
      }
      if (ops > 0) await batch.commit();
    }
    return { deleted };
  }

  async purgeInvalidDealLinks(maxTotal = 10_000): Promise<{ deleted: number }> {
    let cap = Math.trunc(Number(maxTotal));
    if (!Number.isFinite(cap) || cap < 0) cap = 10_000;
    cap = Math.min(cap, 50_000);
    if (cap === 0) return { deleted: 0 };
    let cleared = 0;
    let lastDoc: QueryDocumentSnapshot | undefined;
    const maxPages = 500;
    for (let p = 0; p < maxPages && cleared < cap; p++) {
      const r = await this.offers.deleteInvalidFragmentsPage(Math.min(500, cap - cleared), lastDoc);
      cleared += r.touched;
      lastDoc = r.lastDoc;
      if (!r.hasMore) break;
    }
    return { deleted: cleared };
  }

  async markStaleOlderThan(ttlHours: number, maxScan = 1500): Promise<{ scanned: number; staleMarked: number }> {
    return this.offers.markStaleOlderThan(ttlHours, maxScan);
  }

  pickBestDeal(
    appid: string,
    links: GameDealLinkDoc[],
    opts?: { steamDiscountPercent?: number; steamStoreUrl?: string },
  ): { appid: string; url: string; source: string; dealId?: string } {
    const nowMs = Date.now();
    const active = links
      .filter((l) => this.isActiveNow(l, nowMs))
      .sort((a, b) => a.priority - b.priority);

    const affiliate = active.find((l) => l.isAffiliate);
    if (affiliate) return { appid, url: affiliate.url, source: affiliate.source, dealId: affiliate.dealId };

    const steamDiscountPercent = opts?.steamDiscountPercent ?? 0;
    const steamStoreUrl = opts?.steamStoreUrl ?? `https://store.steampowered.com/app/${appid}`;
    if (steamDiscountPercent > 0) {
      const steamLink = active.find((l) => l.source === 'steam');
      if (steamLink) return { appid, url: steamLink.url, source: steamLink.source, dealId: steamLink.dealId };
      return { appid, url: steamStoreUrl, source: 'steam' };
    }

    return { appid, url: steamStoreUrl, source: 'steam_store' };
  }
}
