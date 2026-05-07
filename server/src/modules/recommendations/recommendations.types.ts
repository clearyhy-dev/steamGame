export type RecommendationReasonCode =
  | 'because_recent'
  | 'similar_taste'
  | 'great_discount'
  | 'high_rated'
  | 'popular_now'
  | 'fresh_deal';

export type HomeRecommendationItem = {
  steamAppId: string;
  dealId: string;
  title: string;
  capsuleImage: string;
  currentPrice: number;
  originalPrice: number;
  discountPercent: number;
  score: number;
  reasons: RecommendationReasonCode[];
  tags: string[];
  /** Steam Store formatted strings for list cards (country-scoped). */
  steamFinalFormatted?: string;
  steamInitialFormatted?: string;
  /** True when only global USD pool data is available for display rules. */
  priceIsGlobalUsd?: boolean;
  /** ITAD (or legacy) fallback display when Steam enrich is absent; formatted in store currency for the requested country. */
  steamListFallbackFormatted?: string;
  steamListFallbackInitialFormatted?: string;
  /** Origin of list price UX: Steam enrich succeeded, ITAD regional Steam shop, or global aggregator pool (e.g. CheapShark). */
  priceSource?: 'steam_store' | 'itad_store' | 'global_pool';
};

export type HomeRecommendationsMeta = {
  steamLinked: boolean;
  effectiveCountry: string;
  effectiveLanguage: string;
  countrySource: 'steam_profile' | 'app_country';
  profileName?: string;
  generatedAt: string;
  cacheHit: boolean;
};

export type HomeRecommendationsResponse = {
  items: HomeRecommendationItem[];
  meta: HomeRecommendationsMeta;
};

export type ExploreRecommendationsResponse = {
  tab: string;
  items: HomeRecommendationItem[];
};
