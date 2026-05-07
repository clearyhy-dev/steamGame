import type { Env } from '../../config/env';
import { AdminSettingsRepository } from '../admin/admin.settings.repository';
import { RegionCountryRepository } from '../config/region-country.repository';
import { SteamStoreService } from '../steam/steam-store.service';
import { SteamService } from '../steam/steam.service';
import { SteamRepository } from '../steam/steam.repository';
import type { SteamGame } from '../steam/steam.types';
import { UsersRepository } from '../users/users.repository';
import { fetchDealsPage, type CheapSharkDealRow } from './cheapshark.client';
import { fetchItadSteamDealsAsCheapSharkRows } from './itad-deals.client';
import { logger } from '../../utils/logger';
import type {
  ExploreRecommendationsResponse,
  HomeRecommendationItem,
  HomeRecommendationsMeta,
  HomeRecommendationsResponse,
  RecommendationReasonCode,
} from './recommendations.types';

const CACHE_TTL_MS = 10 * 60 * 1000;
/** Feed lists (home/explore + public trending): enough rows for categorization + UI. */
const LIST_FEED_MAX = 60;
const DEAL_POOL = 50;
const HTTP_TIMEOUT_MS = 8000;
/** ITAD 池至少这么多条才放弃 CheapShark 兜底（避免大量 lookup 后仍过稀） */
const ITAD_MIN_POOL = 15;

type CacheEntry = { expires: number; payload: HomeRecommendationsResponse };

const homeCache = new Map<string, CacheEntry>();
const publicTrendingCache = new Map<string, CacheEntry>();

const STEAM_PRICE_CONCURRENCY = 5;
const STEAM_ENRICH_MAX_ATTEMPTS = 3;
const STEAM_ENRICH_RETRY_DELAY_MS = 200;

async function mapPool<T, R>(items: T[], pool: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += pool) {
    const chunk = items.slice(i, i + pool);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

function num(v: string | number | undefined, fallback = 0): number {
  if (v == null) return fallback;
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const n = parseFloat(String(v));
  return Number.isFinite(n) ? n : fallback;
}

function parseMetacritic(d: CheapSharkDealRow): number {
  const m = num(d.metacriticScore, NaN);
  if (Number.isFinite(m)) return m;
  return 0;
}

function summarizePriceSources(items: HomeRecommendationItem[]): string {
  let steam = 0;
  let itad = 0;
  let global = 0;
  for (const it of items) {
    const src = String(it.priceSource ?? '').trim().toLowerCase();
    if (src === 'steam_store') steam += 1;
    else if (src === 'itad_store') itad += 1;
    else global += 1;
  }
  return `steam=${steam},itad=${itad},global=${global}`;
}

function isPositiveSteamRating(text?: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return t.includes('positive') || t.includes('%') && !t.includes('0%');
}

function tokenizeName(name: string): Set<string> {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);
  return new Set(words);
}

/** 从用户库取高时长游戏名，用于「相似品味」弱匹配 */
function buildTasteTokens(owned: SteamGame[]): Set<string> {
  const sorted = [...owned].sort((a, b) => (b.playtimeForever ?? 0) - (a.playtimeForever ?? 0));
  const tokens = new Set<string>();
  for (const g of sorted.slice(0, 8)) {
    for (const w of tokenizeName(g.name)) tokens.add(w);
  }
  return tokens;
}

function scoreDeal(
  d: CheapSharkDealRow,
  ownedIds: Set<string>,
  recentIds: Set<string>,
  tasteTokens: Set<string>,
): { score: number; reasons: RecommendationReasonCode[]; skip: boolean } {
  const steamApp = String(d.steamAppID ?? '').trim();
  const reasons: RecommendationReasonCode[] = [];

  if (steamApp && ownedIds.has(steamApp)) {
    return { score: -1e9, reasons: [], skip: true };
  }

  const savings = Math.round(num(d.savings, 0));
  const sale = num(d.salePrice, 0);
  const normal = num(d.normalPrice, 0);
  const ratingCount = typeof d.steamRatingCount === 'number' ? d.steamRatingCount : num(d.steamRatingCount as any, 0);

  let score = 0;
  score += Math.min(savings, 90) * 0.35;
  score += Math.min(ratingCount / 500, 8) * 1.2;

  const mc = parseMetacritic(d);
  if (mc >= 85) {
    score += 8;
    reasons.push('high_rated');
  } else if (mc >= 75) {
    score += 4;
  }

  if (isPositiveSteamRating(d.steamRatingText)) {
    score += 3;
    if (!reasons.includes('high_rated')) reasons.push('high_rated');
  }

  if (savings >= 50) {
    score += 10;
    reasons.push('great_discount');
  } else if (savings >= 30) {
    score += 5;
  }

  if (ratingCount >= 2000) {
    score += 4;
    reasons.push('popular_now');
  }

  const lastCh = typeof d.lastChange === 'number' ? d.lastChange : 0;
  if (lastCh > 0) {
    const days = (Date.now() / 1000 - lastCh) / 86400;
    if (days < 3) {
      score += 3;
      reasons.push('fresh_deal');
    }
  }

  if (steamApp && recentIds.has(steamApp)) {
    score += 14;
    reasons.push('because_recent');
  }

  const title = String(d.title ?? '');
  for (const w of tokenizeName(title)) {
    if (tasteTokens.has(w)) {
      score += 9;
      reasons.push('similar_taste');
      break;
    }
  }

  const uniq = [...new Set(reasons)];
  return { score, reasons: uniq, skip: false };
}

export class RecommendationsService {
  private steam: SteamService;
  private steamRepo: SteamRepository;
  private users: UsersRepository;
  private store: SteamStoreService;
  private countries: RegionCountryRepository;
  private settings = new AdminSettingsRepository();

  constructor(private env: Env) {
    this.steam = new SteamService(env);
    this.steamRepo = new SteamRepository();
    this.users = new UsersRepository();
    this.store = new SteamStoreService(env);
    this.countries = new RegionCountryRepository();
  }

  /** Client `language` query wins; else country catalog `steamLanguage`. */
  private async resolveSteamCatalogLanguage(countryCode: string, languageQuery?: string): Promise<string> {
    const raw = String(languageQuery ?? '').trim().toLowerCase();
    if (raw && /^[a-z]{2}(-[a-z]{2})?$/.test(raw)) return raw;
    const rc = await this.countries.resolveForRegionalDetail(countryCode);
    const cat = String(rc.steamLanguage ?? 'en').trim().toLowerCase();
    return /^[a-z]{2}(-[a-z]{2})?$/.test(cat) ? cat : 'en';
  }

  /**
   * For Steam-linked users, recommendation country should follow Steam profile country.
   * Falls back to app-selected country when profile country is unavailable.
   */
  private profileCountryHydrationFresh(checkedAt: unknown, ttlMs: number): boolean {
    try {
      if (!checkedAt) return false;
      let t = 0;
      if (typeof checkedAt === 'number') t = checkedAt;
      else if (checkedAt instanceof Date) t = checkedAt.getTime();
      else if (typeof checkedAt === 'string') t = Date.parse(checkedAt);
      else if (typeof (checkedAt as any)?.toMillis === 'function') t = (checkedAt as any).toMillis();
      else if (typeof (checkedAt as any)?.toDate === 'function') t = (checkedAt as any).toDate().getTime();
      return t > 0 && Date.now() - t < ttlMs;
    } catch {
      return false;
    }
  }

  private async resolveEffectiveCountryForUser(userId: string, appCountryCode: string): Promise<{
    countryCode: string;
    source: 'steam_profile' | 'app_country';
    steamId?: string;
    profileName?: string;
  }> {
    const appCountry = String(appCountryCode ?? 'US').trim().toUpperCase() || 'US';
    const user = await this.users.findById(userId);
    const steamId = user?.steamId?.trim();
    const profileName = user?.steamPersonaName ?? user?.displayName ?? undefined;
    if (!steamId) {
      return { countryCode: appCountry, source: 'app_country', profileName };
    }

    const hydrationTtlMs = 24 * 60 * 60 * 1000;

    let profile: Awaited<ReturnType<SteamRepository['getSteamProfile']>> = null;
    try {
      profile = await this.steamRepo.getSteamProfile(steamId);
    } catch {
      profile = null;
    }

    const cc = String(profile?.countryCode ?? '')
      .trim()
      .toUpperCase();
    if (/^[A-Z]{2}$/.test(cc)) {
      return { countryCode: cc, source: 'steam_profile', steamId, profileName };
    }

    const forceRefreshOnce = profile?.forceCountryRefreshOnce === true;
    if (!forceRefreshOnce && this.profileCountryHydrationFresh(profile?.countryHydrationCheckedAt, hydrationTtlMs)) {
      logger.info(
        `[recommendations.country] user=${userId} steamId=${steamId} source=app_country reason=hydration_ttl country=${appCountry}`,
      );
      return { countryCode: appCountry, source: 'app_country', steamId, profileName };
    }
    if (forceRefreshOnce) {
      logger.info(`[recommendations.country] user=${userId} steamId=${steamId} reason=force_refresh_once`);
    }

    const fallbackPersona =
      String(profile?.personaName ?? user?.steamPersonaName ?? user?.displayName ?? 'Steam').trim() || 'Steam';

    try {
      const summaries = await this.steam.getPlayerSummaries([steamId]);
      const sum = summaries.find((s) => s.steamId === steamId) ?? summaries[0];
      const live = String(sum?.countryCode ?? '')
        .trim()
        .toUpperCase();
      if (/^[A-Z]{2}$/.test(live)) {
        await this.steamRepo.upsertSteamProfile({
          steamId,
          personaName: String(sum?.personaName ?? '').trim() || fallbackPersona,
          countryCode: live,
          forceCountryRefreshOnce: false,
        });
        logger.info(
          `[recommendations.country] user=${userId} steamId=${steamId} source=steam_profile reason=hydrated_from_steam country=${live}`,
        );
        return { countryCode: live, source: 'steam_profile', steamId, profileName };
      }
      await this.steamRepo.upsertSteamProfile({
        steamId,
        personaName: fallbackPersona,
        forceCountryRefreshOnce: false,
        countryHydrationCheckedAt: new Date(),
      });
      logger.info(
        `[recommendations.country] user=${userId} steamId=${steamId} source=app_country reason=steam_country_empty country=${appCountry}`,
      );
    } catch {
      if (forceRefreshOnce) {
        await this.steamRepo.upsertSteamProfile({
          steamId,
          personaName: fallbackPersona,
          forceCountryRefreshOnce: false,
        });
      }
      logger.warn(
        `[recommendations.country] user=${userId} steamId=${steamId} source=app_country reason=steam_hydration_failed country=${appCountry}`,
      );
    }

    return { countryCode: appCountry, source: 'app_country', steamId, profileName };
  }

  /**
   * 优先 ITAD（Steam 店 deals/v2，Key 来自后台 discount_providers）→ 映射为 CheapShark 行 → 仍走 Steam Store 区域价 enrich。
   * 无 Key 或 ITAD 结果过少时回退 CheapShark。
   */
  private async fetchRecommendationDealPool(
    countryCode: string,
    cheapSharkSortBy: string,
    itadSort?: string,
  ): Promise<CheapSharkDealRow[]> {
    const cfg = await this.settings.getDiscountProviders();
    const key = cfg.itadApiKey?.trim();
    if (key) {
      try {
        const rows = await fetchItadSteamDealsAsCheapSharkRows({
          apiKey: key,
          baseUrl: cfg.itadBaseUrl,
          country: countryCode,
          limit: DEAL_POOL,
          sort: itadSort,
          timeoutMs: HTTP_TIMEOUT_MS,
        });
        if (rows.length >= ITAD_MIN_POOL) {
          return rows;
        }
      } catch {
        /* CheapShark fallback */
      }
    }
    return fetchDealsPage({
      pageSize: Math.min(DEAL_POOL, 60),
      timeoutMs: HTTP_TIMEOUT_MS,
      sortBy: cheapSharkSortBy,
    });
  }

  private async enrichItemsWithSteamRegional(
    items: HomeRecommendationItem[],
    countryCode: string,
    steamLanguageShort: string,
  ): Promise<HomeRecommendationItem[]> {
    if (items.length === 0) return items;
    const rc = await this.countries.resolveForRegionalDetail(countryCode);
    const cc = rc.steamCc;

    return mapPool(items, STEAM_PRICE_CONCURRENCY, async (item) => {
      const sid = String(item.steamAppId ?? '').trim();
      if (!sid) {
        return { ...item, priceIsGlobalUsd: true, priceSource: 'global_pool' };
      }
      let lastErr: unknown;
      for (let attempt = 0; attempt < STEAM_ENRICH_MAX_ATTEMPTS; attempt++) {
        try {
          const row = await this.store.fetchRegionalPrice(sid, cc, steamLanguageShort);
          const fin = String(row?.finalFormatted ?? '').trim();
          if (row && fin.length > 0) {
            return {
              ...item,
              currentPrice: row.salePrice,
              originalPrice: row.regularPrice,
              discountPercent: row.discountPercent,
              steamFinalFormatted: fin,
              steamInitialFormatted: String(row.initialFormatted ?? '').trim() || undefined,
              priceIsGlobalUsd: false,
              priceSource: 'steam_store',
            };
          }
          lastErr = new Error('empty_steam_formatted');
        } catch (e) {
          lastErr = e;
        }
        if (attempt < STEAM_ENRICH_MAX_ATTEMPTS - 1) {
          await new Promise((r) => setTimeout(r, STEAM_ENRICH_RETRY_DELAY_MS * (attempt + 1)));
        }
      }
      if (lastErr != null) {
        console.warn(
          `[recommendations.enrich] Steam regional enrich failed app=${sid} cc=${cc}: ${String(lastErr)}`,
        );
      }
      const fb = String(item.steamListFallbackFormatted ?? '').trim();
      if (fb.length > 0) {
        return {
          ...item,
          priceIsGlobalUsd: false,
          priceSource: 'itad_store',
        };
      }
      return {
        ...item,
        priceIsGlobalUsd: true,
        priceSource: 'global_pool',
      };
    });
  }

  async getHomeRecommendations(
    userId: string,
    countryCode = 'US',
    languageQuery?: string,
  ): Promise<HomeRecommendationsResponse> {
    const startedAt = Date.now();
    const now = Date.now();
    const resolved = await this.resolveEffectiveCountryForUser(userId, countryCode);
    const effectiveCountry = resolved.countryCode;
    const steamLang = await this.resolveSteamCatalogLanguage(effectiveCountry, languageQuery);
    const cacheKey = `${userId}:${effectiveCountry}:${steamLang}`;
    const cached = homeCache.get(cacheKey);
    if (cached && cached.expires > now) {
      return {
        ...cached.payload,
        meta: { ...cached.payload.meta, cacheHit: true },
      };
    }

    const steamId = resolved.steamId;
    const profileName = resolved.profileName;

    let ownedIds = new Set<string>();
    let recentIds = new Set<string>();
    let tasteTokens = new Set<string>();

    if (steamId) {
      try {
        const [ownedR, recentR] = await Promise.all([
          this.steam.getOwnedGamesCached(steamId, false),
          this.steam.getRecentGamesCached(steamId, false),
        ]);
        ownedIds = new Set((ownedR.games ?? []).map((g) => g.appid).filter(Boolean));
        recentIds = new Set((recentR.games ?? []).map((g) => g.appid).filter(Boolean));
        tasteTokens = buildTasteTokens(ownedR.games ?? []);
      } catch (_) {
        /* steam private — keep empty sets */
      }
    }

    const deals = await this.fetchRecommendationDealPool(effectiveCountry, 'Recent', '-cut');
    const scored: { row: CheapSharkDealRow; score: number; reasons: RecommendationReasonCode[] }[] = [];

    for (const d of deals) {
      const steamApp = String(d.steamAppID ?? '').trim();
      if (!steamApp) continue;
      const r = scoreDeal(d, ownedIds, recentIds, tasteTokens);
      if (r.skip) continue;
      scored.push({ row: d, score: r.score, reasons: r.reasons });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, LIST_FEED_MAX);

    let items: HomeRecommendationItem[] = top.map(({ row, score, reasons }) =>
      mapRowToItem(row, score, reasons),
    );

    items = await this.enrichItemsWithSteamRegional(items, effectiveCountry, steamLang);

    const meta: HomeRecommendationsMeta = {
      steamLinked: Boolean(steamId),
      effectiveCountry,
      effectiveLanguage: steamLang,
      countrySource: resolved.source,
      profileName: profileName || undefined,
      generatedAt: new Date().toISOString(),
      cacheHit: false,
    };

    const payload: HomeRecommendationsResponse = { items, meta };
    homeCache.set(cacheKey, { expires: now + CACHE_TTL_MS, payload });
    logger.info(
      `[recommendations.home] user=${userId} steamLinked=${String(Boolean(steamId))} country=${effectiveCountry} lang=${steamLang} source=${resolved.source} items=${items.length} sources={${summarizePriceSources(items)}} ms=${Date.now() - startedAt}`,
    );
    return payload;
  }

  /**
   * Unauthenticated feed: same deal pool + Steam regional enrich as home/explore,
   * without personalization (empty owned/recent/taste).
   */
  async getTrendingPublic(countryCode = 'US', languageQuery?: string): Promise<HomeRecommendationsResponse> {
    const startedAt = Date.now();
    const now = Date.now();
    const steamLang = await this.resolveSteamCatalogLanguage(countryCode, languageQuery);
    const cacheKey = `public:${countryCode}:${steamLang}`;
    const cached = publicTrendingCache.get(cacheKey);
    if (cached && cached.expires > now) {
      return {
        ...cached.payload,
        meta: { ...cached.payload.meta, cacheHit: true },
      };
    }

    const ownedIds = new Set<string>();
    const recentIds = new Set<string>();
    const tasteTokens = new Set<string>();

    const deals = await this.fetchRecommendationDealPool(countryCode, 'Recent', '-cut');
    const scored: { row: CheapSharkDealRow; score: number; reasons: RecommendationReasonCode[] }[] = [];

    for (const d of deals) {
      const steamApp = String(d.steamAppID ?? '').trim();
      if (!steamApp) continue;
      const r = scoreDeal(d, ownedIds, recentIds, tasteTokens);
      if (r.skip) continue;
      scored.push({ row: d, score: r.score, reasons: r.reasons });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, LIST_FEED_MAX);
    let items: HomeRecommendationItem[] = top.map(({ row, score, reasons }) =>
      mapRowToItem(row, score, reasons),
    );
    items = await this.enrichItemsWithSteamRegional(items, countryCode, steamLang);

    const meta: HomeRecommendationsMeta = {
      steamLinked: false,
      effectiveCountry: countryCode,
      effectiveLanguage: steamLang,
      countrySource: 'app_country',
      generatedAt: new Date().toISOString(),
      cacheHit: false,
    };

    const payload: HomeRecommendationsResponse = { items, meta };
    publicTrendingCache.set(cacheKey, { expires: now + CACHE_TTL_MS, payload });
    logger.info(
      `[recommendations.trending_public] country=${countryCode} lang=${steamLang} items=${items.length} sources={${summarizePriceSources(items)}} ms=${Date.now() - startedAt}`,
    );
    return payload;
  }

  /** Explore tabs：trending | deep | hidden | for_you */
  async getExplore(
    userId: string,
    tabRaw: string,
    countryCode = 'US',
    languageQuery?: string,
  ): Promise<ExploreRecommendationsResponse> {
    const startedAt = Date.now();
    const resolved = await this.resolveEffectiveCountryForUser(userId, countryCode);
    const effectiveCountry = resolved.countryCode;
    const tab = (tabRaw || 'trending').toLowerCase().replace(/-/g, '_');
    if (tab === 'for_you' || tab === 'foryou') {
      const home = await this.getHomeRecommendations(userId, effectiveCountry, languageQuery);
      return { tab: 'for_you', items: home.items };
    }

    const steamId = resolved.steamId;
    let ownedIds = new Set<string>();
    let recentIds = new Set<string>();
    let tasteTokens = new Set<string>();
    if (steamId) {
      try {
        const [ownedR, recentR] = await Promise.all([
          this.steam.getOwnedGamesCached(steamId, false),
          this.steam.getRecentGamesCached(steamId, false),
        ]);
        ownedIds = new Set((ownedR.games ?? []).map((g) => g.appid).filter(Boolean));
        recentIds = new Set((recentR.games ?? []).map((g) => g.appid).filter(Boolean));
        tasteTokens = buildTasteTokens(ownedR.games ?? []);
      } catch (_) {}
    }

    let sortBy = 'Deal Rating';
    let itadSort: string | undefined;
    if (tab === 'deep_discounts' || tab === 'deep') {
      sortBy = 'Savings';
      itadSort = '-cut';
    } else if (tab === 'hidden_gems' || tab === 'hidden') {
      sortBy = 'Metacritic';
      itadSort = '-cut';
    } else {
      sortBy = 'Deal Rating';
      itadSort = undefined;
    }

    const deals = await this.fetchRecommendationDealPool(effectiveCountry, sortBy, itadSort);
    const scored: { row: CheapSharkDealRow; score: number; reasons: RecommendationReasonCode[] }[] = [];

    for (const d of deals) {
      const steamApp = String(d.steamAppID ?? '').trim();
      if (!steamApp) continue;
      const r = scoreDeal(d, ownedIds, recentIds, tasteTokens);
      if (r.skip) continue;
      const rc = (tab === 'hidden_gems' || tab === 'hidden') ? filterHiddenGem(d, r) : r;
      if (rc.skip) continue;
      scored.push({ row: d, score: rc.score, reasons: rc.reasons });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, LIST_FEED_MAX);
    let items: HomeRecommendationItem[] = top.map(({ row, score, reasons }) =>
      mapRowToItem(row, score, reasons),
    );
    const steamLang = await this.resolveSteamCatalogLanguage(effectiveCountry, languageQuery);
    items = await this.enrichItemsWithSteamRegional(items, effectiveCountry, steamLang);

    const response = { tab: tabRaw || 'trending', items };
    logger.info(
      `[recommendations.explore] user=${userId} tab=${response.tab} steamLinked=${String(Boolean(resolved.steamId))} country=${effectiveCountry} lang=${steamLang} source=${resolved.source} items=${items.length} sources={${summarizePriceSources(items)}} ms=${Date.now() - startedAt}`,
    );
    return response;
  }
}

function filterHiddenGem(
  d: CheapSharkDealRow,
  base: { score: number; reasons: RecommendationReasonCode[]; skip: boolean },
): { score: number; reasons: RecommendationReasonCode[]; skip: boolean } {
  if (base.skip) return base;
  const ratingCount = typeof d.steamRatingCount === 'number' ? d.steamRatingCount : Number(d.steamRatingCount ?? 0);
  const savings = Math.round(num(d.savings, 0));
  if (ratingCount > 8000 || savings < 20) return { ...base, skip: true };
  return { ...base, score: base.score + 5, reasons: [...base.reasons, 'fresh_deal'] };
}

function mapRowToItem(
  row: CheapSharkDealRow,
  score: number,
  reasons: RecommendationReasonCode[],
): HomeRecommendationItem {
  const steamAppId = String(row.steamAppID ?? '');
  const sale = num(row.salePrice, 0);
  const normal = num(row.normalPrice, 0);
  const savings = Math.round(num(row.savings, 0));
  const thumb = String(row.thumb ?? '');
  const itadSale = String(row.itadSaleFormatted ?? '').trim();
  const itadReg = String(row.itadRegularFormatted ?? '').trim();
  const fromItad = row.listPriceSource === 'itad_store' && itadSale.length > 0;
  return {
    steamAppId,
    dealId: String(row.dealID ?? ''),
    title: String(row.title ?? ''),
    capsuleImage: thumb,
    currentPrice: sale,
    originalPrice: normal,
    discountPercent: savings,
    score: Math.round(score * 10) / 10,
    reasons: reasons.length ? reasons : ['popular_now'],
    tags: reasons.slice(0, 3),
    steamListFallbackFormatted: fromItad ? itadSale : undefined,
    steamListFallbackInitialFormatted: fromItad && itadReg.length > 0 ? itadReg : undefined,
    priceIsGlobalUsd: !fromItad,
    priceSource: fromItad ? 'itad_store' : 'global_pool',
  };
}
