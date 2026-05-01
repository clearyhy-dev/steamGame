import admin from 'firebase-admin';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getFirestore } from '../../config/firebase';

export type GameCatalogDoc = {
  appid: string;
  name: string;
  detailSynced?: boolean;
  steamStoreUrl?: string;
  headerImage?: string;
  capsuleImage?: string;
  screenshots: string[];
  trailerUrls: string[];
  shortDescription?: string;
  detailedDescription?: string;
  developers?: string[];
  publishers?: string[];
  categories?: string[];
  genres?: string[];
  tags?: string[];
  isFree?: boolean;
  priceInitial?: number;
  priceFinal?: number;
  discountPercent?: number;
  steamDiscounted?: boolean;
  currentPlayers?: number;
  lastPlayersSyncAt?: admin.firestore.Timestamp;
  discountUrl?: string;
  clickCount?: number;
  lastDetailSyncAt?: admin.firestore.Timestamp;
  reviewSummary?: {
    reviewScoreDesc: string;
    positivePercent: number;
    totalReviews: number;
    totalPositive: number;
    totalNegative: number;
  } | null;
  reviewCount?: number;
  lastMetaSyncedAt?: admin.firestore.Timestamp;
  lastReviewsSyncedAt?: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
  createdAt: admin.firestore.Timestamp;
};

function omitUndefinedRecord(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

const GAME_COLLECTION = 'game_catalog';
const REVIEW_COLLECTION = 'game_reviews';

export class GameCatalogRepository {
  private db = getFirestore();

  async upsertMeta(input: {
    appid: string;
    name: string;
    headerImage?: string;
    screenshots?: string[];
    trailerUrls?: string[];
    shortDescription?: string;
    categories?: string[];
    genres?: string[];
    discountUrl?: string;
    steamStoreUrl?: string;
    capsuleImage?: string;
    detailedDescription?: string;
    developers?: string[];
    publishers?: string[];
    tags?: string[];
    isFree?: boolean;
    priceInitial?: number;
    priceFinal?: number;
    discountPercent?: number;
    steamDiscounted?: boolean;
    currentPlayers?: number;
  }): Promise<void> {
    const ref = this.db.collection(GAME_COLLECTION).doc(input.appid);
    const now = admin.firestore.Timestamp.now();
    const existing = await ref.get();
    const base = existing.exists ? (existing.data() as Partial<GameCatalogDoc>) : {};
    const payload = omitUndefinedRecord({
      appid: input.appid,
      name: input.name || base.name || `App ${input.appid}`,
      detailSynced: true,
      headerImage: input.headerImage ?? base.headerImage,
      capsuleImage: input.capsuleImage ?? base.capsuleImage,
      screenshots: input.screenshots ?? base.screenshots ?? [],
      trailerUrls: input.trailerUrls ?? base.trailerUrls ?? [],
      shortDescription: input.shortDescription ?? base.shortDescription,
      detailedDescription: input.detailedDescription ?? base.detailedDescription,
      steamStoreUrl: input.steamStoreUrl ?? base.steamStoreUrl ?? `https://store.steampowered.com/app/${input.appid}`,
      developers: input.developers ?? base.developers ?? [],
      publishers: input.publishers ?? base.publishers ?? [],
      categories: input.categories ?? base.categories ?? [],
      genres: input.genres ?? base.genres ?? [],
      tags: input.tags ?? base.tags ?? [],
      isFree: input.isFree ?? base.isFree ?? false,
      priceInitial: input.priceInitial ?? base.priceInitial ?? 0,
      priceFinal: input.priceFinal ?? base.priceFinal ?? 0,
      discountPercent: input.discountPercent ?? base.discountPercent ?? 0,
      steamDiscounted: input.steamDiscounted ?? base.steamDiscounted ?? false,
      currentPlayers: input.currentPlayers ?? base.currentPlayers ?? 0,
      lastPlayersSyncAt: input.currentPlayers !== undefined ? now : (base.lastPlayersSyncAt ?? now),
      discountUrl: input.discountUrl ?? base.discountUrl,
      lastMetaSyncedAt: now,
      lastDetailSyncAt: now,
      updatedAt: now,
      createdAt: base.createdAt ?? now,
    });
    await ref.set(payload, { merge: true });
  }

  async setDiscountUrl(appid: string, discountUrl: string): Promise<void> {
    const ref = this.db.collection(GAME_COLLECTION).doc(appid);
    const now = admin.firestore.Timestamp.now();
    await ref.set(
      {
        appid,
        discountUrl,
        updatedAt: now,
        createdAt: now,
      },
      { merge: true },
    );
  }

  async getByAppid(appid: string): Promise<GameCatalogDoc | null> {
    const snap = await this.db.collection(GAME_COLLECTION).doc(appid).get();
    if (!snap.exists) return null;
    return snap.data() as GameCatalogDoc;
  }

  async listByAppids(appids: string[]): Promise<GameCatalogDoc[]> {
    const ids = Array.from(
      new Set(
        appids
          .map((x) => String(x ?? '').trim())
          .filter(Boolean),
      ),
    );
    if (ids.length === 0) return [];
    const out: GameCatalogDoc[] = [];
    for (let i = 0; i < ids.length; i += 10) {
      const part = ids.slice(i, i + 10);
      const snap = await this.db.collection(GAME_COLLECTION).where('appid', 'in', part).get();
      out.push(...snap.docs.map((d: QueryDocumentSnapshot) => d.data() as GameCatalogDoc));
    }
    return out;
  }

  async upsertAppListItems(
    items: Array<{ appid: string; name: string }>,
    opts?: { chunkSize?: number },
  ): Promise<{ processed: number; inserted: number; updated: number; skipped: number }> {
    const chunkSize = Math.max(50, Math.min(opts?.chunkSize ?? 400, 500));
    let processed = 0;
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const now = admin.firestore.Timestamp.now();

    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      const refs = chunk.map((it) => this.db.collection(GAME_COLLECTION).doc(it.appid));
      const docs = await this.db.getAll(...refs);
      const batch = this.db.batch();
      for (let idx = 0; idx < chunk.length; idx += 1) {
        const it = chunk[idx];
        const snap = docs[idx];
        processed += 1;
        if (!it.appid) {
          skipped += 1;
          continue;
        }
        if (!snap.exists) {
          inserted += 1;
          batch.set(snap.ref, {
            appid: it.appid,
            name: it.name || `App ${it.appid}`,
            detailSynced: false,
            steamStoreUrl: `https://store.steampowered.com/app/${it.appid}`,
            screenshots: [],
            trailerUrls: [],
            categories: [],
            genres: [],
            tags: [],
            clickCount: 0,
            currentPlayers: 0,
            createdAt: now,
            updatedAt: now,
          });
          continue;
        }
        const data = snap.data() as Partial<GameCatalogDoc>;
        const currentName = String(data.name ?? '').trim();
        const nextName = it.name.trim();
        if (typeof data.detailSynced !== 'boolean') {
          const inferred = !!data.lastDetailSyncAt;
          updated += 1;
          batch.set(snap.ref, { detailSynced: inferred, updatedAt: now }, { merge: true });
          continue;
        }
        if (nextName && currentName !== nextName) {
          updated += 1;
          batch.set(snap.ref, { name: nextName, updatedAt: now }, { merge: true });
        } else {
          skipped += 1;
        }
      }
      await batch.commit();
    }

    return { processed, inserted, updated, skipped };
  }

  async list(limit = 1000): Promise<GameCatalogDoc[]> {
    const n = Math.max(1, Math.min(limit, 2000));
    const snap = await this.db.collection(GAME_COLLECTION).orderBy('updatedAt', 'desc').limit(n).get();
    return snap.docs.map((d: QueryDocumentSnapshot) => d.data() as GameCatalogDoc);
  }

  async listByAppidPage(offset: number, limit: number): Promise<GameCatalogDoc[]> {
    const n = Math.max(1, Math.min(limit, 500));
    const o = Math.max(0, Math.trunc(offset));
    const snap = await this.db.collection(GAME_COLLECTION).orderBy('appid', 'asc').offset(o).limit(n).get();
    return snap.docs.map((d: QueryDocumentSnapshot) => d.data() as GameCatalogDoc);
  }

  async listByAppidCursor(afterAppid: string, limit: number): Promise<GameCatalogDoc[]> {
    const n = Math.max(1, Math.min(limit, 500));
    let q = this.db.collection(GAME_COLLECTION).orderBy('appid', 'asc').limit(n);
    const cursor = String(afterAppid ?? '').trim();
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    return snap.docs.map((d: QueryDocumentSnapshot) => d.data() as GameCatalogDoc);
  }

  /**
   * 按 appid 顺序扫描，返回最多 `limit` 个「未写 lastDetailSyncAt」的游戏。
   * 不再用 slice 截断，避免与游标不同步；`exhausted` 表示已读到库尾。
   */
  async listUnsyncedByCursor(
    afterAppid: string,
    limit: number,
  ): Promise<{ rows: GameCatalogDoc[]; exhausted: boolean }> {
    const n = Math.max(1, Math.min(limit, 500));
    const out: GameCatalogDoc[] = [];
    let cursor = String(afterAppid ?? '').trim();
    let exhausted = false;

    outer: while (out.length < n) {
      let q = this.db.collection(GAME_COLLECTION).orderBy('appid', 'asc').limit(500);
      if (cursor) q = q.startAfter(cursor);
      const snap = await q.get();
      if (snap.empty) {
        exhausted = true;
        break;
      }
      const rows = snap.docs.map((d: QueryDocumentSnapshot) => d.data() as GameCatalogDoc);
      for (const r of rows) {
        if (!r.lastDetailSyncAt) {
          out.push(r);
          if (out.length >= n) break outer;
        }
      }
      cursor = rows[rows.length - 1]?.appid ?? cursor;
      if (rows.length < 500) exhausted = true;
    }

    return { rows: out, exhausted };
  }

  async queryForAdmin(params: {
    appid?: string;
    keyword?: string;
    hasDealLink?: boolean;
    hasDetailSynced?: boolean;
    minDiscountPercent?: number;
    limit?: number;
    page?: number;
    pageSize?: number;
    sortBy?: 'online_desc' | 'updated_desc' | 'discount_desc';
  }): Promise<GameCatalogDoc[]> {
    const pageSize = Math.max(1, Math.min(params.pageSize ?? params.limit ?? 100, 500));
    const page = Math.max(1, Math.trunc(params.page ?? 1));
    const sortBy = params.sortBy ?? 'online_desc';
    let baseQuery = this.db.collection(GAME_COLLECTION) as FirebaseFirestore.Query;
    if (typeof params.hasDetailSynced === 'boolean') {
      const desired = params.hasDetailSynced;
      const targetStart = (page - 1) * pageSize;
      const targetEnd = targetStart + pageSize;
      const matched: GameCatalogDoc[] = [];
      let offset = 0;
      const scanChunk = 1000;
      while (matched.length < targetEnd) {
        const snap = await this.db
          .collection(GAME_COLLECTION)
          .orderBy('appid', 'asc')
          .offset(offset)
          .limit(scanChunk)
          .get();
        if (snap.empty) break;
        let rows = snap.docs.map((d: QueryDocumentSnapshot) => d.data() as GameCatalogDoc);
        const appid = String(params.appid ?? '').trim();
        const keyword = String(params.keyword ?? '').trim().toLowerCase();
        if (appid) rows = rows.filter((r) => r.appid === appid);
        if (keyword) rows = rows.filter((r) => r.name.toLowerCase().includes(keyword) || r.appid.includes(keyword));
        if (typeof params.minDiscountPercent === 'number') {
          rows = rows.filter((r) => (r.discountPercent ?? 0) >= params.minDiscountPercent!);
        }
        rows = rows.filter((r) => (desired ? !!r.lastDetailSyncAt : !r.lastDetailSyncAt));
        matched.push(...rows);
        offset += snap.size;
        if (snap.size < scanChunk) break;
      }
      return matched.slice(targetStart, targetEnd);
    }
    {
      if (sortBy === 'discount_desc') baseQuery = baseQuery.orderBy('discountPercent', 'desc');
      else if (sortBy === 'online_desc') baseQuery = baseQuery.orderBy('currentPlayers', 'desc');
      else baseQuery = baseQuery.orderBy('updatedAt', 'desc');
    }
    const snap = await baseQuery.offset((page - 1) * pageSize).limit(pageSize).get();
    let rows = snap.docs.map((d: QueryDocumentSnapshot) => d.data() as GameCatalogDoc);
    const appid = String(params.appid ?? '').trim();
    const keyword = String(params.keyword ?? '').trim().toLowerCase();
    if (appid) rows = rows.filter((r) => r.appid === appid);
    if (keyword) rows = rows.filter((r) => r.name.toLowerCase().includes(keyword) || r.appid.includes(keyword));
    if (typeof params.minDiscountPercent === 'number') {
      rows = rows.filter((r) => (r.discountPercent ?? 0) >= params.minDiscountPercent!);
    }
    if (typeof params.hasDetailSynced === 'boolean') {
      rows = rows.filter((r) => (params.hasDetailSynced ? !!r.lastDetailSyncAt : !r.lastDetailSyncAt));
    }
    if (params.hasDealLink === true) {
      rows = rows.filter((r) => !!r.discountUrl);
    }
    return rows;
  }

  async countAll(): Promise<number> {
    const snap = await this.db.collection(GAME_COLLECTION).count().get();
    return Number(snap.data().count ?? 0);
  }

  async countForAdmin(params: {
    minDiscountPercent?: number;
    hasDetailSynced?: boolean;
  }): Promise<number> {
    if (typeof params.hasDetailSynced === 'boolean') {
      const syncedQuery = this.db
        .collection(GAME_COLLECTION)
        .where('lastDetailSyncAt', '>', admin.firestore.Timestamp.fromMillis(0));
      const syncedCount = Number((await syncedQuery.count().get()).data().count ?? 0);
      if (params.hasDetailSynced) return syncedCount;
      const allCount = await this.countAll();
      return Math.max(0, allCount - syncedCount);
    }
    let q = this.db.collection(GAME_COLLECTION) as FirebaseFirestore.Query;
    if (
      typeof params.minDiscountPercent === 'number' &&
      Number.isFinite(params.minDiscountPercent) &&
      params.minDiscountPercent > 0
    ) {
      q = q.where('discountPercent', '>=', params.minDiscountPercent);
    }
    if (typeof params.hasDetailSynced === 'boolean') {
      q = q.where('detailSynced', '==', params.hasDetailSynced);
    }
    const snap = await q.count().get();
    return Number(snap.data().count ?? 0);
  }

  async increaseClickCount(appid: string): Promise<void> {
    const key = String(appid ?? '').trim();
    if (!key) return;
    const ref = this.db.collection(GAME_COLLECTION).doc(key);
    const now = admin.firestore.Timestamp.now();
    await ref.set(
      {
        appid: key,
        clickCount: admin.firestore.FieldValue.increment(1),
        updatedAt: now,
        createdAt: now,
      },
      { merge: true },
    );
  }

  async saveReviews(
    appid: string,
    summary: GameCatalogDoc['reviewSummary'],
    reviews: Array<Record<string, unknown>>,
  ): Promise<void> {
    const now = admin.firestore.Timestamp.now();
    await this.db.collection(REVIEW_COLLECTION).doc(appid).set(
      {
        appid,
        reviews,
        updatedAt: now,
      },
      { merge: true },
    );
    await this.db.collection(GAME_COLLECTION).doc(appid).set(
      {
        appid,
        reviewSummary: summary ?? null,
        reviewCount: reviews.length,
        lastReviewsSyncedAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  }

  async getReviews(appid: string): Promise<{ reviews: Array<Record<string, unknown>>; updatedAt: admin.firestore.Timestamp | null }> {
    const snap = await this.db.collection(REVIEW_COLLECTION).doc(appid).get();
    if (!snap.exists) return { reviews: [], updatedAt: null };
    const d = snap.data() as { reviews?: Array<Record<string, unknown>>; updatedAt?: admin.firestore.Timestamp };
    return { reviews: d.reviews ?? [], updatedAt: d.updatedAt ?? null };
  }
}

