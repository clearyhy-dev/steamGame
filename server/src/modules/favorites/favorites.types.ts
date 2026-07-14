export type FavoriteSource = 'owned' | 'recent' | 'manual';

export type FavoritePlatformBaseline = {
  finalPrice: number;
  currency: string;
  url?: string;
  originalPrice?: number | null;
  discountPercent?: number | null;
};

export type FavoriteBaselinePrices = {
  countryCode: string;
  capturedAt: string;
  platforms: {
    steam?: FavoritePlatformBaseline;
    isthereanydeal?: FavoritePlatformBaseline;
    ggdeals?: FavoritePlatformBaseline;
  };
  lowestFinalPrice: number;
  lowestCurrency: string;
};

export type FavoriteGame = {
  appid: string;
  name: string;
  headerImage?: string;
  source: FavoriteSource;
  createdAt?: FirebaseTimestampLike;
  baselinePrices?: FavoriteBaselinePrices;
  lastEmailAlertAt?: string;
  /** Default true for Pro users when baseline is captured. */
  emailAlertsEnabled?: boolean;
};

export type FirebaseTimestampLike = unknown;

export function userIsPro(user: { proUntilMs?: number | null } | null | undefined, nowMs = Date.now()): boolean {
  const until = Number(user?.proUntilMs ?? 0);
  return Number.isFinite(until) && until > nowMs;
}
