import axios from 'axios';
import admin from 'firebase-admin';
import { ITAD_API } from '../config/external-deal-api.catalog';
import type { ItadDetailSnapshot } from './game-catalog.repository';
import { itadLookupBySteamAppId, itadFetchGamePricesV3 } from './itad-api.client';

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function moneyNode(v: unknown): { amount?: number; amountInt?: number; currency?: string } | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const amount = num(o.amount);
  const amountInt = num(o.amountInt);
  const currency = String(o.currency ?? '').trim().toUpperCase() || undefined;
  if (amount == null && amountInt == null && !currency) return undefined;
  return { amount, amountInt, currency };
}

type Auth = Record<string, string>;

function isItadPricesV3Array(raw: unknown): raw is unknown[] {
  return Array.isArray(raw) && raw.length > 0;
}

/**
 * 在折扣同步之外补充 ITAD：史低多维、价格历史片段、bundles、info 统计（waitlist 等）。
 * 若已传入与该国同步相同的 `games/prices/v3` 响应体，则不再重复 POST。
 * 失败时返回带 `error` 的片段，不抛异常。
 */
export async function fetchItadEnrichmentForCountry(params: {
  appid: string;
  itadCountry: string;
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  /** 折扣同步阶段 `games/lookup` 已得 id 时可传入，少一次 lookup */
  itadGameId?: string;
  /** 与 `itadGameId` + `itadCountry` 对应的 `POST games/prices/v3` 原始 JSON（数组） */
  pricesV3Payload?: unknown;
}): Promise<ItadDetailSnapshot> {
  const now = admin.firestore.Timestamp.now();
  const base = String(params.baseUrl || ITAD_API.baseUrlDefault).replace(/\/+$/, '');
  const country = String(params.itadCountry || 'US')
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const auths: Auth[] = [{ key: params.apiKey }, { token: params.apiKey }];
  const t = Math.max(params.timeoutMs, 10000);

  const emptyErr = (msg: string): ItadDetailSnapshot => ({ syncedAt: now, error: msg });

  let gameId: string | null = params.itadGameId?.trim() || null;
  if (!gameId) {
    const lookup = await itadLookupBySteamAppId({
      apiKey: params.apiKey,
      baseUrl: base,
      appid: params.appid,
      timeoutMs: t,
    });
    gameId = lookup?.itadGameId ?? null;
  }
  if (!gameId) return emptyErr('lookup_failed');

  const out: ItadDetailSnapshot = {
    itadGameId: gameId,
    itadApiCountry: country,
    syncedAt: now,
    steamAppId: Number(params.appid) || undefined,
  };

  const run = async <T>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch {
      return null;
    }
  };

  const pricesFromSync = params.pricesV3Payload;
  const [pricesData, infoData, historyData, bundlesData] = await Promise.all([
    isItadPricesV3Array(pricesFromSync)
      ? Promise.resolve(pricesFromSync)
      : run(async () =>
          itadFetchGamePricesV3({
            apiKey: params.apiKey,
            baseUrl: base,
            itadGameIds: [gameId!],
            country,
            timeoutMs: t,
          }),
        ),
    run(async () => {
      for (const auth of auths) {
        const r = await axios.get(`${base}/games/info/v2`, {
          params: { ...auth, id: gameId },
          timeout: t,
          validateStatus: () => true,
        });
        if (r.data && !r.data?.error) return r.data;
      }
      return null;
    }),
    run(async () => {
      for (const auth of auths) {
        /** `shops=61`：Steam 店（与 ITAD 站点上常见 Steam 历史曲线一致）；按国 `country` 取价 */
        const r = await axios.get(`${base}/games/history/v2`, {
          params: { ...auth, id: gameId, country, shops: '61' },
          timeout: t,
          validateStatus: () => true,
        });
        if (Array.isArray(r.data)) return r.data;
      }
      return null;
    }),
    run(async () => {
      for (const auth of auths) {
        const r = await axios.get(`${base}/games/bundles/v2`, {
          params: { ...auth, id: gameId, country, expired: false },
          timeout: t,
          validateStatus: () => true,
        });
        if (Array.isArray(r.data)) return r.data;
      }
      return null;
    }),
  ]);

  if (Array.isArray(pricesData) && pricesData[0]) {
    const first = pricesData[0] as Record<string, unknown>;
    const hl = first.historyLow as Record<string, unknown> | undefined;
    if (hl && typeof hl === 'object') {
      out.historyLow = {
        all: moneyNode(hl.all),
        y1: moneyNode(hl.y1),
        m3: moneyNode(hl.m3),
      };
    }
  }

  if (infoData && typeof infoData === 'object') {
    const stats = (infoData as Record<string, unknown>).stats as Record<string, unknown> | undefined;
    if (stats && typeof stats === 'object') {
      out.stats = {
        waitlisted: num(stats.waitlisted),
        collected: num(stats.collected),
        rank: num(stats.rank),
      };
    }
  }

  if (Array.isArray(historyData)) {
    const mapped = historyData.map((row: unknown) => {
      const h = row as Record<string, unknown>;
      const deal = (h.deal ?? {}) as Record<string, unknown>;
      const shop = (h.shop ?? {}) as Record<string, unknown>;
      const price = (deal.price ?? {}) as Record<string, unknown>;
      return {
        timestamp: String(h.timestamp ?? ''),
        shopId: num(shop.id),
        shopName: String(shop.name ?? ''),
        cut: num(deal.cut),
        priceAmount: num(price.amount),
        currency: String(price.currency ?? '').trim().toUpperCase(),
      };
    });
    mapped.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    out.priceHistory = mapped.slice(-365);
  }

  if (Array.isArray(bundlesData)) {
    out.bundles = bundlesData.slice(0, 12).map((b: unknown) => {
      const x = b as Record<string, unknown>;
      const page = (x.page ?? {}) as Record<string, unknown>;
      return {
        id: num(x.id),
        title: String(x.title ?? ''),
        url: String(x.url ?? ''),
        expiry: String(x.expiry ?? ''),
        shopName: String(page.name ?? ''),
      };
    });
  }

  return out;
}
