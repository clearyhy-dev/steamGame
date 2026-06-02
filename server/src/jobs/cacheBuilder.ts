import type { Env } from '../config/env';
import { cacheUploadTargetLabel, uploadPublicCacheJson } from '../cache/cache-object-upload';
import { GameCatalogRepository } from '../modules/game/game-catalog.repository';
import { GameDiscountOffersRepository } from '../modules/game/game-discount-offers.repository';
import { DealAggregatorService, type AggregatedDealCard } from '../modules/game/deal-aggregator.service';
import { logger } from '../utils/logger';

const CACHE_CONTROL_DISCOUNTS = 'public, max-age=1800, s-maxage=1800';
const CACHE_CONTROL_TRENDING = 'public, max-age=3600, s-maxage=3600';
const CACHE_CONTROL_PRICES = 'public, max-age=21600, s-maxage=21600';

async function buildTopDiscountsForCountry(
  catalog: GameCatalogRepository,
  offers: GameDiscountOffersRepository,
  agg: DealAggregatorService,
  country: string,
  seeds: Awaited<ReturnType<GameCatalogRepository['queryForAdmin']>>,
): Promise<{ country: string; generatedAt: string; items: AggregatedDealCard[] }> {
  const items: AggregatedDealCard[] = [];
  for (const row of seeds.slice(0, 40)) {
    const bucketDoc = await offers.getBucket(row.appid, country);
    const bucket = bucketDoc ? offers.countryBucketFromDoc(bucketDoc) : null;
    items.push(agg.fromCatalogAndBucket(row, bucket, country));
  }
  return { country, generatedAt: new Date().toISOString(), items };
}

async function buildCountryPricesFile(
  catalog: GameCatalogRepository,
  offers: GameDiscountOffersRepository,
  agg: DealAggregatorService,
  country: string,
  seedAppids: string[],
): Promise<{ country: string; generatedAt: string; items: AggregatedDealCard[] }> {
  const items: AggregatedDealCard[] = [];
  for (const appid of seedAppids.slice(0, 80)) {
    const cat = await catalog.getByAppid(appid);
    if (!cat) continue;
    const bucketDoc = await offers.getBucket(appid, country);
    const bucket = bucketDoc ? offers.countryBucketFromDoc(bucketDoc) : null;
    items.push(agg.fromCatalogAndBucket(cat, bucket, country));
  }
  return { country, generatedAt: new Date().toISOString(), items };
}

/**
 * 从 Firestore 聚合热门/折扣快照并写入 GCS `cache/*.json`（供 CDN 边缘命中，降 Firestore 读）。
 */
export async function runCacheBuild(
  env: Env,
): Promise<{ target: string; backend: 'gcs' | 's3'; keys: string[] }> {
  const target = cacheUploadTargetLabel(env);
  if (!target) {
    throw new Error(
      'Configure cache upload: S3_* (CACHE_UPLOAD_BACKEND=s3) or GCS_CACHE_BUCKET / VIDEO_GCS_BUCKET (gcs)',
    );
  }
  const catalog = new GameCatalogRepository();
  const offers = new GameDiscountOffersRepository(env);
  const agg = new DealAggregatorService();

  const topDiscountSeeds = await catalog.queryForAdmin({
    sortBy: 'discount_desc',
    pageSize: 60,
    page: 1,
  });
  const trendingSeeds = await catalog.queryForAdmin({
    sortBy: 'online_desc',
    pageSize: 500,
    page: 1,
  });

  const keys: string[] = [];
  const now = new Date().toISOString();

  for (const cc of ['US', 'JP', 'KR'] as const) {
    const top = await buildTopDiscountsForCountry(catalog, offers, agg, cc, topDiscountSeeds);
    const path = `cache/top-discounts-${cc.toLowerCase()}.json`;
    await uploadPublicCacheJson(env, path, top, CACHE_CONTROL_DISCOUNTS);
    keys.push(path);
    logger.info(`[cacheBuilder] uploaded ${path}`);
  }

  const trendingPayload = {
    generatedAt: now,
    items: trendingSeeds.slice(0, 100).map((r) => ({
      appid: r.appid,
      name: r.name,
      currentPlayers: r.currentPlayers ?? 0,
      discountPercent: r.discountPercent ?? 0,
      capsuleImage: r.capsuleImage,
      steamStoreUrl: r.steamStoreUrl,
    })),
  };
  await uploadPublicCacheJson(env, 'cache/trending-games.json', trendingPayload, CACHE_CONTROL_TRENDING);
  keys.push('cache/trending-games.json');

  const gameHeatPayload = {
    generatedAt: now,
    source: 'game_catalog',
    items: trendingSeeds.slice(0, 500).map((r) => ({
      appid: r.appid,
      name: r.name,
      currentPlayers: r.currentPlayers ?? 0,
      discountPercent: r.discountPercent ?? 0,
      capsuleImage: r.capsuleImage ?? null,
    })),
  };
  await uploadPublicCacheJson(env, 'cache/game-heat.json', gameHeatPayload, CACHE_CONTROL_TRENDING);
  keys.push('cache/game-heat.json');

  const reviewSeed = await catalog.queryForAdmin({ sortBy: 'online_desc', pageSize: 120, page: 1 });
  const reviewHighlights = {
    generatedAt: now,
    items: reviewSeed
      .filter((r) => r.reviewSummary != null)
      .slice(0, 80)
      .map((r) => ({
        appid: r.appid,
        name: r.name,
        reviewSummary: r.reviewSummary,
        reviewCount: r.reviewCount ?? null,
      })),
  };
  await uploadPublicCacheJson(env, 'cache/review-highlights.json', reviewHighlights, CACHE_CONTROL_TRENDING);
  keys.push('cache/review-highlights.json');

  const hotDealsPayload = {
    generatedAt: now,
    items: await buildTopDiscountsForCountry(catalog, offers, agg, 'US', topDiscountSeeds).then((x) => x.items),
  };
  await uploadPublicCacheJson(env, 'cache/hot-deals.json', hotDealsPayload, CACHE_CONTROL_DISCOUNTS);
  keys.push('cache/hot-deals.json');

  const priceSeedIds = trendingSeeds.slice(0, 80).map((r) => r.appid);
  for (const cc of ['US', 'JP', 'KR'] as const) {
    const prices = await buildCountryPricesFile(catalog, offers, agg, cc, priceSeedIds);
    const path = `cache/${cc.toLowerCase()}-prices.json`;
    await uploadPublicCacheJson(env, path, prices, CACHE_CONTROL_PRICES);
    keys.push(path);
    logger.info(`[cacheBuilder] uploaded ${path}`);
  }

  await uploadPublicCacheJson(
    env,
    'cache/popular-searches.json',
    {
      generatedAt: now,
      queries: ['RPG', 'open world', 'roguelike', 'multiplayer', 'indie'],
    },
    CACHE_CONTROL_TRENDING,
  );
  keys.push('cache/popular-searches.json');

  logger.info(`[cacheBuilder] done target=${target} backend=${env.cacheUploadBackend} files=${keys.length}`);
  return { target, backend: env.cacheUploadBackend, keys };
}
