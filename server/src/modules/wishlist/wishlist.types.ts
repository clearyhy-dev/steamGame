export type WishlistDecisionKind = 'buy_now' | 'wait' | 'watch' | 'skip_for_now';

export type WishlistDecisionItem = {
  appid: string;
  name: string;
  headerImage: string;
  decision: WishlistDecisionKind;
  reasonCodes: string[];
  currentPrice: number;
  originalPrice: number;
  discountPercent: number;
  dealId?: string;
};

export type WishlistDecisionsResponse = {
  items: WishlistDecisionItem[];
};
