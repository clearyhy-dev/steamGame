import type { GameCatalogDoc, GameCountryPriceBucket, RegionalSourcePriceSnapshot } from './game-catalog.repository';

/** 跨 Steam / ITAD / GG / CheapShark 的统一卡片结构（缓存 builder 与公开 API 可复用） */
export type AggregatedDealCard = {
  gameId: string;
  steamAppId: string;
  title: string;
  country: string;
  originalPrice: number | null;
  discountPrice: number | null;
  discountPercent: number | null;
  platform: 'steam' | 'isthereanydeal' | 'ggdeals' | 'cheapshark' | 'catalog_steam';
  currency: string | null;
  updatedAt: string | null;
  capsuleImage?: string;
  steamStoreUrl?: string;
};

function tsIso(t: { toDate?: () => Date } | undefined): string | null {
  try {
    return t?.toDate?.()?.toISOString() ?? null;
  } catch {
    return null;
  }
}

function pickBestSource(
  b: GameCountryPriceBucket,
): { snap: RegionalSourcePriceSnapshot; platform: AggregatedDealCard['platform'] } | null {
  const candidates: Array<{ snap: RegionalSourcePriceSnapshot; platform: AggregatedDealCard['platform'] }> = [];
  if (b.steam) candidates.push({ snap: b.steam, platform: 'steam' });
  if (b.isthereanydeal) candidates.push({ snap: b.isthereanydeal, platform: 'isthereanydeal' });
  if (b.ggdeals) candidates.push({ snap: b.ggdeals, platform: 'ggdeals' });
  if (b.cheapshark) candidates.push({ snap: b.cheapshark, platform: 'cheapshark' });
  let best: (typeof candidates)[0] | null = null;
  let bestFinal = -1;
  for (const c of candidates) {
    const fp = typeof c.snap.finalPrice === 'number' ? c.snap.finalPrice : -1;
    if (fp > 0 && (best == null || fp < bestFinal)) {
      best = c;
      bestFinal = fp;
    }
  }
  return best;
}

export class DealAggregatorService {
  /** 合并目录主站价与某国分桶多源价，优先可买的最低 finalPrice */
  fromCatalogAndBucket(
    catalog: GameCatalogDoc,
    bucket: GameCountryPriceBucket | null,
    country: string,
  ): AggregatedDealCard {
    const cc = String(country ?? 'US')
      .trim()
      .toUpperCase();
    const fromBucket = bucket ? pickBestSource(bucket) : null;
    const catFinal = typeof catalog.priceFinal === 'number' ? catalog.priceFinal : null;
    const catOrig = typeof catalog.priceInitial === 'number' ? catalog.priceInitial : null;
    const catDisc = typeof catalog.discountPercent === 'number' ? catalog.discountPercent : null;

    if (fromBucket) {
      const s = fromBucket.snap;
      const fp = typeof s.finalPrice === 'number' ? s.finalPrice : null;
      const op = typeof s.originalPrice === 'number' ? s.originalPrice : null;
      const dp = typeof s.discountPercent === 'number' ? s.discountPercent : null;
      return {
        gameId: catalog.appid,
        steamAppId: catalog.appid,
        title: catalog.name,
        country: cc,
        originalPrice: op ?? catOrig,
        discountPrice: fp ?? catFinal,
        discountPercent: dp ?? catDisc,
        platform: fromBucket.platform,
        currency: s.currency ? String(s.currency) : null,
        updatedAt: tsIso(s.lastPriceSyncAt ?? s.syncedAt),
        capsuleImage: catalog.capsuleImage,
        steamStoreUrl: catalog.steamStoreUrl,
      };
    }

    return {
      gameId: catalog.appid,
      steamAppId: catalog.appid,
      title: catalog.name,
      country: cc,
      originalPrice: catOrig,
      discountPrice: catFinal,
      discountPercent: catDisc,
      platform: 'catalog_steam',
      currency: null,
      updatedAt: catalog.updatedAt ? tsIso(catalog.updatedAt) : null,
      capsuleImage: catalog.capsuleImage,
      steamStoreUrl: catalog.steamStoreUrl,
    };
  }
}
