import type { Env } from '../../config/env';
import { SteamService } from '../steam/steam.service';
import type { SteamGame } from '../steam/steam.types';
import { UsersRepository } from '../users/users.repository';
import { fetchDealsPage, type CheapSharkDealRow } from './cheapshark.client';
import type {
  ExploreRecommendationsResponse,
  HomeRecommendationItem,
  HomeRecommendationsMeta,
  HomeRecommendationsResponse,
  RecommendationReasonCode,
} from './recommendations.types';

const CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_ITEMS = 12;
const DEAL_POOL = 50;
const HTTP_TIMEOUT_MS = 8000;

type CacheEntry = { expires: number; payload: HomeRecommendationsResponse };

const homeCache = new Map<string, CacheEntry>();

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
  private users: UsersRepository;

  constructor(private env: Env) {
    this.steam = new SteamService(env);
    this.users = new UsersRepository();
  }

  async getHomeRecommendations(userId: string): Promise<HomeRecommendationsResponse> {
    const now = Date.now();
    const cached = homeCache.get(userId);
    if (cached && cached.expires > now) {
      return {
        ...cached.payload,
        meta: { ...cached.payload.meta, cacheHit: true },
      };
    }

    const user = await this.users.findById(userId);
    const steamId = user?.steamId?.trim();
    const profileName = user?.steamPersonaName ?? user?.displayName;

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

    const deals = await fetchDealsPage({ pageSize: DEAL_POOL, timeoutMs: HTTP_TIMEOUT_MS });
    const scored: { row: CheapSharkDealRow; score: number; reasons: RecommendationReasonCode[] }[] = [];

    for (const d of deals) {
      const steamApp = String(d.steamAppID ?? '').trim();
      if (!steamApp) continue;
      const r = scoreDeal(d, ownedIds, recentIds, tasteTokens);
      if (r.skip) continue;
      scored.push({ row: d, score: r.score, reasons: r.reasons });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, MAX_ITEMS);

    const items: HomeRecommendationItem[] = top.map(({ row, score, reasons }) => {
      const steamAppId = String(row.steamAppID ?? '');
      const sale = num(row.salePrice, 0);
      const normal = num(row.normalPrice, 0);
      const savings = Math.round(num(row.savings, 0));
      const thumb = String(row.thumb ?? '');
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
      };
    });

    const meta: HomeRecommendationsMeta = {
      steamLinked: Boolean(steamId),
      profileName: profileName || undefined,
      generatedAt: new Date().toISOString(),
      cacheHit: false,
    };

    const payload: HomeRecommendationsResponse = { items, meta };
    homeCache.set(userId, { expires: now + CACHE_TTL_MS, payload });
    return payload;
  }

  /** Explore tabs：trending | deep | hidden | for_you */
  async getExplore(userId: string, tabRaw: string): Promise<ExploreRecommendationsResponse> {
    const tab = (tabRaw || 'trending').toLowerCase().replace(/-/g, '_');
    if (tab === 'for_you' || tab === 'foryou') {
      const home = await this.getHomeRecommendations(userId);
      return { tab: 'for_you', items: home.items };
    }

    const user = await this.users.findById(userId);
    const steamId = user?.steamId?.trim();
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
    if (tab === 'deep_discounts' || tab === 'deep') sortBy = 'Savings';
    if (tab === 'hidden_gems' || tab === 'hidden') sortBy = 'Metacritic';

    const deals = await fetchDealsPage({ pageSize: 50, timeoutMs: HTTP_TIMEOUT_MS, sortBy });
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
    const top = scored.slice(0, MAX_ITEMS);
    const items: HomeRecommendationItem[] = top.map(({ row, score, reasons }) => mapRowToItem(row, score, reasons));

    return { tab: tabRaw || 'trending', items };
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
  };
}
