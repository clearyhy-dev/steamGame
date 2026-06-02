import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getFirestore } from '../../config/firebase';
import type { GameCatalogDoc } from '../game/game-catalog.repository';
import { GameDealLinkRepository } from '../game/game-deal-link.repository';
import type { Env } from '../../config/env';
import { calendarDayKey, dealPriceDayTz, isPriceSyncedOnCalendarDay } from '../game/deal-price-day.util';
import { usesS3ObjectStorage } from '../../storage/s3-client';
import type { GameDealLinkDoc } from '../game/game-deal-link.repository';
import {
  ensureTodayPriceSyncIndex,
  isPriceSyncIndexConfigured,
  listPriceSyncedAppids,
  rebuildPriceSyncIndexFromObjectStorage,
} from '../../cache/price-sync-index';
import { listDiscountOfferObjects, maxLastModifiedByAppid } from '../../cache/discount-offer-object-list';

const GAME_COLLECTION = 'game_catalog';

export type PriceSyncedFilter = 'today' | 'yes' | 'no';

function normKeyword(v: string): string {
  return String(v ?? '').trim().toLowerCase();
}

async function getCatalogByAppids(appids: string[]): Promise<GameCatalogDoc[]> {
  if (appids.length === 0) return [];
  const db = getFirestore();
  const out: GameCatalogDoc[] = [];
  for (let i = 0; i < appids.length; i += 400) {
    const slice = appids.slice(i, i + 400);
    const refs = slice.map((id) => db.collection(GAME_COLLECTION).doc(id));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) {
      if (s.exists) out.push(s.data() as GameCatalogDoc);
    }
  }
  return out;
}

function filterDealsByCountry(deals: GameDealLinkDoc[], discountCountry: string): GameDealLinkDoc[] {
  if (!discountCountry) return deals;
  const cc = discountCountry.toUpperCase();
  return deals.filter((d) => String(d.countryCode ?? 'US').trim().toUpperCase() === cc);
}

function matchesPriceSyncedDeals(
  deals: GameDealLinkDoc[],
  mode: PriceSyncedFilter,
  discountSource?: string,
): boolean {
  let pool = deals;
  if (discountSource) pool = deals.filter((d) => d.source === discountSource);
  if (mode === 'today') return pool.some((d) => isPriceSyncedOnCalendarDay(d.lastPriceSyncAt));
  if (mode === 'yes') return pool.some((d) => !!d.lastPriceSyncAt);
  return !pool.some((d) => !!d.lastPriceSyncAt);
}

function sortCatalog(docs: GameCatalogDoc[], sortBy: 'online_desc' | 'updated_desc' | 'discount_desc'): void {
  if (sortBy === 'discount_desc') {
    docs.sort((a, b) => (b.discountPercent ?? 0) - (a.discountPercent ?? 0) || a.appid.localeCompare(b.appid));
    return;
  }
  if (sortBy === 'updated_desc') {
    docs.sort((a, b) => {
      const ta = a.lastDetailSyncAt?.toMillis() ?? 0;
      const tb = b.lastDetailSyncAt?.toMillis() ?? 0;
      return tb - ta || a.appid.localeCompare(b.appid);
    });
    return;
  }
  docs.sort(
    (a, b) => (b.currentPlayers ?? 0) - (a.currentPlayers ?? 0) || a.appid.localeCompare(b.appid),
  );
}

function applyCatalogFilters(
  doc: GameCatalogDoc,
  params: {
    appid?: string;
    keyword?: string;
    minDiscountPercent?: number;
    hasDetailSynced?: boolean;
  },
): boolean {
  if (params.appid && doc.appid !== params.appid) return false;
  const keyword = normKeyword(params.keyword ?? '');
  if (keyword && !doc.name.toLowerCase().includes(keyword) && !doc.appid.includes(keyword)) return false;
  if ((params.minDiscountPercent ?? 0) > 0 && (doc.discountPercent ?? 0) < params.minDiscountPercent!) {
    return false;
  }
  if (typeof params.hasDetailSynced === 'boolean') {
    if (params.hasDetailSynced !== !!doc.lastDetailSyncAt) return false;
  }
  return true;
}

type ScanParams = {
  priceSynced: PriceSyncedFilter;
  page: number;
  pageSize: number;
  sortBy: 'online_desc' | 'updated_desc' | 'discount_desc';
  appid?: string;
  keyword?: string;
  minDiscountPercent?: number;
  hasDetailSynced?: boolean;
  discountCountry?: string;
  discountSource?: string;
};

function paginateCatalog(matched: GameCatalogDoc[], params: ScanParams): { rows: GameCatalogDoc[]; total: number } {
  sortCatalog(matched, params.sortBy);
  const total = matched.length;
  const start = (params.page - 1) * params.pageSize;
  return { rows: matched.slice(start, start + params.pageSize), total };
}

async function filterAppidsByDealSource(
  env: Env,
  appids: string[],
  params: ScanParams,
): Promise<string[]> {
  const discountCountry = String(params.discountCountry ?? '').trim().toUpperCase();
  const discountSource = String(params.discountSource ?? '').trim().toLowerCase();
  if (!discountSource) return appids;

  const dealsRepo = new GameDealLinkRepository(env);
  const filtered: string[] = [];
  for (let i = 0; i < appids.length; i += 80) {
    const slice = appids.slice(i, i + 80);
    const map = await dealsRepo.listActiveByAppids(slice);
    for (const appid of slice) {
      const countryDeals = filterDealsByCountry(map.get(appid) ?? [], discountCountry);
      if (matchesPriceSyncedDeals(countryDeals, params.priceSynced, discountSource)) {
        filtered.push(appid);
      }
    }
  }
  return filtered;
}

/** Redis SET：毫秒级取今日/曾同步 appid 列表 */
async function scanViaPriceSyncIndex(
  env: Env,
  params: ScanParams,
): Promise<{ rows: GameCatalogDoc[]; total: number }> {

  const syncMode = params.priceSynced === 'yes' ? 'yes' : 'today';
  let appids =
    (await listPriceSyncedAppids(syncMode, {
      countryCode: params.discountCountry,
      source: params.discountSource,
    })) ?? [];

  if (appids.length === 0 && syncMode === 'today') {
    try {
      await rebuildPriceSyncIndexFromObjectStorage(env);
      appids =
        (await listPriceSyncedAppids(syncMode, {
          countryCode: params.discountCountry,
          source: params.discountSource,
        })) ?? [];
    } catch {
      /* 重建失败则按当前空集继续 */
    }
  }

  if (params.discountSource) {
    appids = await filterAppidsByDealSource(env, appids, params);
  }

  const matched = (await getCatalogByAppids(appids)).filter((doc) => applyCatalogFilters(doc, params));
  return paginateCatalog(matched, params);
}

/** MinIO 列表（无 Redis 时的回退） */
async function scanViaObjectStorage(env: Env, params: ScanParams): Promise<{ rows: GameCatalogDoc[]; total: number }> {
  const tz = dealPriceDayTz();
  const todayKey = calendarDayKey(Date.now(), tz);
  const rows = await listDiscountOfferObjects(env);
  const offerByAppid = maxLastModifiedByAppid(rows);
  const discountCountry = String(params.discountCountry ?? '').trim().toUpperCase();
  const discountSource = String(params.discountSource ?? '').trim().toLowerCase();

  if (params.priceSynced === 'no') {
    const withOffer = new Set(offerByAppid.keys());
    const matched: GameCatalogDoc[] = [];
    let offset = 0;
    const chunk = 400;
    const db = getFirestore();
    while (true) {
      const snap = await db.collection(GAME_COLLECTION).orderBy('appid', 'asc').offset(offset).limit(chunk).get();
      if (snap.empty) break;
      for (const d of snap.docs) {
        const doc = d.data() as GameCatalogDoc;
        if (withOffer.has(doc.appid)) continue;
        if (!applyCatalogFilters(doc, params)) continue;
        if (discountCountry || discountSource) {
          const deals = new GameDealLinkRepository(env);
          const links = filterDealsByCountry(await deals.listByAppid(doc.appid), discountCountry);
          if (links.length > 0) continue;
        }
        matched.push(doc);
      }
      offset += snap.size;
      if (snap.size < chunk) break;
    }
    return paginateCatalog(matched, params);
  }

  const idSet = new Set<string>();
  for (const r of rows) {
    if (params.priceSynced === 'yes') {
      idSet.add(r.appid);
      continue;
    }
    if (params.priceSynced === 'today' && calendarDayKey(r.lastModifiedMs, tz) === todayKey) {
      if (!discountCountry || r.countryCode.toUpperCase() === discountCountry) {
        idSet.add(r.appid);
      }
    }
  }

  let candidateAppids = [...idSet];
  if (discountSource) {
    candidateAppids = await filterAppidsByDealSource(env, candidateAppids, params);
  }

  const matched = (await getCatalogByAppids(candidateAppids)).filter((doc) => applyCatalogFilters(doc, params));
  return paginateCatalog(matched, params);
}

/** Firestore 分桶模式：全库扫描（慢，仅非 object_storage 时） */
async function scanViaDealLinks(env: Env, params: ScanParams): Promise<{ rows: GameCatalogDoc[]; total: number }> {
  const db = getFirestore();
  const deals = new GameDealLinkRepository(env);
  const discountCountry = String(params.discountCountry ?? '').trim().toUpperCase();
  const discountSource = String(params.discountSource ?? '').trim().toLowerCase();
  const matched: GameCatalogDoc[] = [];
  let offset = 0;
  const chunk = 400;

  while (true) {
    const snap = await db
      .collection(GAME_COLLECTION)
      .orderBy('appid', 'asc')
      .offset(offset)
      .limit(chunk)
      .get();
    if (snap.empty) break;

    const batch = snap.docs.map((d: QueryDocumentSnapshot) => d.data() as GameCatalogDoc);
    const dealMap = await deals.listActiveByAppids(batch.map((r) => r.appid));

    for (const doc of batch) {
      if (!applyCatalogFilters(doc, params)) continue;
      const countryDeals = filterDealsByCountry(dealMap.get(doc.appid) ?? [], discountCountry);
      if (!matchesPriceSyncedDeals(countryDeals, params.priceSynced, discountSource || undefined)) continue;
      matched.push(doc);
    }

    offset += snap.size;
    if (snap.size < chunk) break;
  }

  return paginateCatalog(matched, params);
}

export async function scanCatalogForPriceSyncedFilter(
  env: Env,
  params: ScanParams,
): Promise<{ rows: GameCatalogDoc[]; total: number }> {
  if (isPriceSyncIndexConfigured()) {
    return scanViaPriceSyncIndex(env, params);
  }

  if (usesS3ObjectStorage(env) && env.discountOffersPersistence === 'object_storage') {
    ensureTodayPriceSyncIndex(env);
    return scanViaObjectStorage(env, params);
  }
  return scanViaDealLinks(env, params);
}

export function priceSyncedTodayForDeals(
  deals: GameDealLinkDoc[],
  discountSource?: string,
): boolean {
  const pool = discountSource ? deals.filter((d) => d.source === discountSource) : deals;
  return pool.some((d) => isPriceSyncedOnCalendarDay(d.lastPriceSyncAt));
}

export { maxLastPriceSyncIso } from '../game/deal-sync-skip.util';
