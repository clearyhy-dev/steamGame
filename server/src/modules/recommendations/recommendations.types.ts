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
};

export type HomeRecommendationsMeta = {
  steamLinked: boolean;
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
