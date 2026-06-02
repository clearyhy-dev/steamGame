import admin from 'firebase-admin';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getFirestore } from '../../config/firebase';
import { useSqliteRelationalStore } from '../../config/database';

/** 某国、某来源的价与链接快照（用于多国对比；与 `game_discount_offers` 同构） */
export type RegionalSourcePriceSnapshot = {
  url?: string;
  currency?: string;
  originalPrice?: number;
  finalPrice?: number;
  discountPercent?: number;
  syncedAt: admin.firestore.Timestamp;
  /** 本次拉取失败时记录 */
  error?: string;
  /** 稳定键（与 deal 扁平化 `dealId` 规则一致） */
  dealId?: string;
  priority?: number;
  isActive?: boolean;
  isAffiliate?: boolean;
  offerStatus?: 'active' | 'stale' | 'invalid';
  invalidReason?: string;
  lastCheckedAt?: admin.firestore.Timestamp;
  lastPriceSyncAt?: admin.firestore.Timestamp;
  hotnessScore?: number;
  startAt?: admin.firestore.Timestamp | null;
  endAt?: admin.firestore.Timestamp | null;
};

export type ItadMoneySnapshot = {
  amount?: number;
  amountInt?: number;
  currency?: string;
};

/** ITAD 扩展：史低、历史价片段、bundles、waitlist 类统计 */
export type ItadDetailSnapshot = {
  itadGameId?: string;
  steamAppId?: number;
  /** 请求 ITAD API 时使用的 ISO2（与 `region_country_configs.itadCountry` 一致） */
  itadApiCountry?: string;
  syncedAt: admin.firestore.Timestamp;
  error?: string;
  historyLow?: { all?: ItadMoneySnapshot; y1?: ItadMoneySnapshot; m3?: ItadMoneySnapshot };
  stats?: { waitlisted?: number; collected?: number; rank?: number };
  priceHistory?: Array<{
    timestamp?: string;
    shopId?: number;
    shopName?: string;
    cut?: number;
    priceAmount?: number;
    currency?: string;
  }>;
  bundles?: Array<{ id?: number; title?: string; url?: string; expiry?: string; shopName?: string }>;
};

/**
 * GG.deals `GET /v1/prices/by-steam-app-id/` 单游戏 `data[appid].prices` 官方字段（与站方 API 用法一致，见 ggdeals-steam-companion）。
 */
export type GgOfficialPricesSnapshot = {
  currentRetail?: number;
  currentKeyshops?: number;
  historicalRetail?: number;
  historicalKeyshops?: number;
  currency?: string;
  /** 两路现价都有时，与站方一致取较低一侧 */
  lowestCurrentSource?: 'retail' | 'keyshop';
};

/** GG.deals 扩展：官方 prices 块写入 `game_discount_offers` 分桶的 `ggDetail`（热度类标签不在 prices 接口，勿用 Steam 推导冒充） */
export type GgDetailSnapshot = {
  ggApiRegion?: string;
  syncedAt: admin.firestore.Timestamp;
  error?: string;
  /** 本次是否成功拉到 GG 价格接口 */
  priceSyncOk?: boolean;
  /** 仅来自 `prices/by-steam-app-id` 的 JSON，映射路径固定 */
  prices?: GgOfficialPricesSnapshot;
  chartNote?: string;
  /** 以下字段为历史版本写入的 Steam 推导标签；新同步不再写入，读取旧文档时仍可能存在 */
  trendScore?: number;
  hotToday?: boolean;
  trending?: boolean;
  rising?: boolean;
  recentAttention?: boolean;
  playerRatingPercent?: number;
  playerRatingLabel?: string;
};

/** 值得买指数（与 `worth-buy.util` 公式一致） */
export type WorthBuyStoredSnapshot = {
  score: number;
  D: number;
  R: number;
  P: number;
  T: number;
  formula: string;
  computedAt: admin.firestore.Timestamp;
};

/**
 * 按业务国 `countryCode`（ISO2）分桶；与 Country/Steam 配置页一致。
 * 各平台请求参数见 `steamCc` / `itadCountry` / `ggDealsRegion`。
 */
export type GameCountryPriceBucket = {
  countryCode: string;
  steamCc?: string;
  itadCountry?: string;
  ggDealsRegion?: string;
  cheapsharkCountry?: string;
  steam?: RegionalSourcePriceSnapshot;
  isthereanydeal?: RegionalSourcePriceSnapshot;
  ggdeals?: RegionalSourcePriceSnapshot;
  cheapshark?: RegionalSourcePriceSnapshot;
  itadDetail?: ItadDetailSnapshot;
  ggDetail?: GgDetailSnapshot;
  worthBuy?: WorthBuyStoredSnapshot;
  /** 整轮多源同步完成时间（可选，由调用方置位） */
  lastFullSyncAt?: admin.firestore.Timestamp;
};

export type GameCatalogDoc = {
  appid: string;
  name: string;
  detailSynced?: boolean;
  steamStoreUrl?: string;
  headerImage?: string;
  capsuleImage?: string;
  screenshots: string[];
  trailerUrls: string[];
  /** 与 trailerUrls 同序；Steam movies[].thumbnail */
  trailerThumbnailUrls?: string[];
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
  /** 列表排序用镜像，仅由「周热度同步」任务从 `game_weekly_heat` 写入 */
  currentPlayers?: number;
  lastPlayersSyncAt?: admin.firestore.Timestamp;
  clickCount?: number;
  lastDetailSyncAt?: admin.firestore.Timestamp;
  /** Steam appdetails 无数据（下架/DLC 等），批量同步时跳过 */
  detailUnavailable?: boolean;
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

const PLAYERS_DAILY_MAX = 400;

export function mergePlayersDaily(
  existing: Array<{ day: string; players: number }> | undefined,
  currentPlayers: number,
): Array<{ day: string; players: number }> {
  const day = new Date().toISOString().slice(0, 10);
  const n = Math.max(0, Math.trunc(Number(currentPlayers)));
  const arr = Array.isArray(existing) ? [...existing] : [];
  const i = arr.findIndex((x) => x && x.day === day);
  const row = { day, players: n };
  if (i >= 0) arr[i] = row;
  else arr.push(row);
  arr.sort((a, b) => a.day.localeCompare(b.day));
  return arr.slice(-PLAYERS_DAILY_MAX);
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
    trailerThumbnailUrls?: string[];
    shortDescription?: string;
    categories?: string[];
    genres?: string[];
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
      trailerThumbnailUrls: input.trailerThumbnailUrls ?? base.trailerThumbnailUrls ?? [],
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
      lastMetaSyncedAt: now,
      lastDetailSyncAt: now,
      updatedAt: now,
      createdAt: base.createdAt ?? now,
    });
    await ref.set(payload, { merge: true });
  }

  /** 仅周热度任务写入，供 `orderBy('currentPlayers')` 等列表排序 */
  async setPlayerHeatMirror(appid: string, currentPlayers: number): Promise<void> {
    const key = String(appid ?? '').trim();
    if (!key) return;
    const ref = this.db.collection(GAME_COLLECTION).doc(key);
    const now = admin.firestore.Timestamp.now();
    const n = Math.max(0, Math.trunc(Number(currentPlayers)));
    await ref.set(
      {
        appid: key,
        currentPlayers: n,
        lastPlayersSyncAt: now,
        updatedAt: now,
      },
      { merge: true },
    );
  }

  /**
   * 从 `game_catalog` 文档物理删除已废弃字段：`byCountry`、`playersDaily`、`discountUrl`
   *（比价与链接由 `game_discount_offers` 承担；在线趋势在 `game_weekly_heat`）。
   */
  async purgeLegacyCatalogFieldsForAllGames(pageSize = 400): Promise<{ gamesUpdated: number }> {
    const n = Math.max(50, Math.min(pageSize, 500));
    let gamesUpdated = 0;
    let lastAppid: string | null = null;
    for (;;) {
      let q = this.db.collection(GAME_COLLECTION).orderBy('appid', 'asc').limit(n);
      if (lastAppid) q = q.startAfter(lastAppid);
      const snap = await q.get();
      if (snap.empty) break;
      const now = admin.firestore.Timestamp.now();
      let batch = this.db.batch();
      let ops = 0;
      for (const d of snap.docs) {
        batch.update(d.ref, {
          byCountry: admin.firestore.FieldValue.delete(),
          playersDaily: admin.firestore.FieldValue.delete(),
          discountUrl: admin.firestore.FieldValue.delete(),
          updatedAt: now,
        });
        ops += 1;
        if (ops >= 450) {
          await batch.commit();
          batch = this.db.batch();
          ops = 0;
        }
      }
      if (ops > 0) await batch.commit();
      gamesUpdated += snap.size;
      const last = snap.docs[snap.docs.length - 1]?.data() as GameCatalogDoc | undefined;
      lastAppid = last?.appid ?? null;
      if (!lastAppid) break;
    }
    return { gamesUpdated };
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
   * 按 appid 升序扫描库，在内存中过滤名称/appid 子串；`cursor` 为上一页返回的 `nextCursor`（上次扫描到的 appid），用于稳定分页。
   */
  async searchByKeywordAppidCursor(params: {
    keyword: string;
    cursor: string;
    limit: number;
    maxBatches?: number;
  }): Promise<{ items: GameCatalogDoc[]; nextCursor: string; exhausted: boolean }> {
    const kw = String(params.keyword ?? '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(Math.trunc(Number(params.limit) || 20), 50));
    const maxBatches = Math.max(1, Math.min(Math.trunc(Number(params.maxBatches) ?? 40), 200));
    let scanAfter = String(params.cursor ?? '').trim();
    const items: GameCatalogDoc[] = [];
    let exhausted = false;

    for (let batch = 0; batch < maxBatches && items.length < limit; batch++) {
      let q = this.db.collection(GAME_COLLECTION).orderBy('appid', 'asc').limit(150);
      if (scanAfter) q = q.startAfter(scanAfter);
      const snap = await q.get();
      if (snap.empty) {
        exhausted = true;
        break;
      }
      const last = snap.docs[snap.docs.length - 1]?.data() as GameCatalogDoc;
      scanAfter = last.appid;

      for (const d of snap.docs) {
        const r = d.data() as GameCatalogDoc;
        if (r.name.toLowerCase().includes(kw) || r.appid.includes(kw)) {
          items.push(r);
          if (items.length >= limit) break;
        }
      }

      if (snap.size < 150) {
        exhausted = true;
        break;
      }
    }

    return { items, nextCursor: scanAfter, exhausted };
  }

  /**
   * 按 appid 顺序扫描，返回最多 `limit` 个「尚未完成详情同步」的游戏。
   * 已写 `lastDetailSyncAt` 或 `detailSynced === true` 的条目跳过。
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

    const needsDetailSync = (r: GameCatalogDoc): boolean =>
      !r.detailUnavailable && !r.lastDetailSyncAt && r.detailSynced !== true;

    if (useSqliteRelationalStore()) {
      const m = await import('../../storage/sqlite/game-catalog.store');
      return m.sqliteListUnsyncedByNumericAppid(cursor, n);
    }

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
        if (needsDetailSync(r)) {
          out.push(r);
          if (out.length >= n) break outer;
        }
      }
      cursor = rows[rows.length - 1]?.appid ?? cursor;
      if (rows.length < 500) exhausted = true;
    }

    return { rows: out, exhausted };
  }

  /** 按 Steam 当前在线人数（catalog 镜像）降序，用于热度 TopN 流水线 */
  async listTopByCurrentPlayers(limit: number, offset = 0): Promise<GameCatalogDoc[]> {
    const lim = Math.max(1, Math.min(Math.trunc(limit) || 500, 2000));
    const off = Math.max(0, Math.trunc(offset));
    if (useSqliteRelationalStore()) {
      const m = await import('../../storage/sqlite/game-catalog.store');
      return m.sqliteListTopByCurrentPlayers(lim, off);
    }
    const snap = await this.db
      .collection(GAME_COLLECTION)
      .orderBy('currentPlayers', 'desc')
      .orderBy('appid', 'asc')
      .offset(off)
      .limit(lim)
      .get();
    return snap.docs.map((d: QueryDocumentSnapshot) => d.data() as GameCatalogDoc);
  }

  /** 热度榜内尚未拉取详情的 appid（按 currentPlayers 降序取前 topN 条候选） */
  async listTopAppidsMissingDetailAmongHot(topN: number): Promise<string[]> {
    const lim = Math.max(1, Math.min(Math.trunc(topN) || 500, 2000));
    if (useSqliteRelationalStore()) {
      const m = await import('../../storage/sqlite/game-catalog.store');
      return m.sqliteListTopAppidsMissingDetail(lim);
    }
    const hot = await this.listTopByCurrentPlayers(lim * 2, 0);
    return hot
      .filter((r) => !r.lastDetailSyncAt && !r.detailUnavailable)
      .slice(0, lim)
      .map((r) => r.appid);
  }

  async queryForAdmin(params: {
    appid?: string;
    keyword?: string;
    hasDetailSynced?: boolean;
    minDiscountPercent?: number;
    limit?: number;
    page?: number;
    pageSize?: number;
    sortBy?: 'online_desc' | 'updated_desc' | 'discount_desc';
  }): Promise<GameCatalogDoc[]> {
    if (useSqliteRelationalStore()) {
      const m = await import('../../storage/sqlite/game-catalog.store');
      return m.sqliteQueryCatalogForAdmin(params);
    }
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
    return rows;
  }

  /**
   * 全库扫描后按「折扣热度」排序：主站 discountPercent 为主、currentPlayers 为辅（与折扣同步选品一致）。
   * 用于定时任务按平台拉价时的候选列表（可限制为 catalog 上当前有折扣的条目）。
   */
  async listAppidsForDiscountHeatSync(params: {
    limit: number;
    /** 仅 (discountPercent>0 或 steamDiscounted) */
    todayDiscountOnly?: boolean;
    /** 默认 true：只选已同步详情的游戏，避免大量 zero_price */
    requireDetailSynced?: boolean;
  }): Promise<Array<{ appid: string; name?: string }>> {
    const limit = Math.max(1, Math.min(Math.trunc(Number(params.limit) || 500), 8000));
    const todayOnly = params.todayDiscountOnly === true;
    const needDetail = params.requireDetailSynced !== false;
    const heat = (doc: GameCatalogDoc): number => {
      const d = Math.max(0, Math.min(100, Number(doc.discountPercent ?? 0)));
      const p = Math.min(5_000_000, Math.max(0, Number(doc.currentPlayers ?? 0)));
      return d * 6_000_000 + p;
    };
    const matched: GameCatalogDoc[] = [];
    let dbOffset = 0;
    const chunk = 400;
    while (true) {
      const snap = await this.db
        .collection(GAME_COLLECTION)
        .orderBy('appid', 'asc')
        .offset(dbOffset)
        .limit(chunk)
        .get();
      if (snap.empty) break;
      for (const d of snap.docs) {
        const doc = d.data() as GameCatalogDoc;
        if (needDetail && !doc.lastDetailSyncAt) continue;
        if (todayOnly && (doc.discountPercent ?? 0) <= 0 && doc.steamDiscounted !== true) continue;
        matched.push(doc);
      }
      dbOffset += snap.size;
      if (snap.size < chunk) break;
    }
    matched.sort((a, b) => heat(b) - heat(a) || a.appid.localeCompare(b.appid));
    return matched.slice(0, limit).map((d) => ({ appid: d.appid, name: d.name }));
  }

  async countAll(): Promise<number> {
    const snap = await this.db.collection(GAME_COLLECTION).count().get();
    return Number(snap.data().count ?? 0);
  }

  async markDetailUnavailable(appid: string): Promise<void> {
    const key = String(appid ?? '').trim();
    if (!key) return;
    if (useSqliteRelationalStore()) {
      const m = await import('../../storage/sqlite/game-catalog.store');
      await m.sqliteMarkDetailUnavailable(key);
      return;
    }
    const now = admin.firestore.Timestamp.now();
    await this.db.collection(GAME_COLLECTION).doc(key).set(
      { detailUnavailable: true, detailUnavailableAt: now, updatedAt: now },
      { merge: true },
    );
  }

  async countForAdmin(params: {
    minDiscountPercent?: number;
    hasDetailSynced?: boolean;
  }): Promise<number> {
    if (useSqliteRelationalStore()) {
      const m = await import('../../storage/sqlite/game-catalog.store');
      return m.sqliteCountCatalogForAdmin(params);
    }
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

