import type { Env } from '../../config/env';
import { FavoritesRepository } from '../favorites/favorites.repository';
import { fetchDealGameInfo, fetchGameBySteamAppId } from '../recommendations/cheapshark.client';
import type { WishlistDecisionItem, WishlistDecisionsResponse } from './wishlist.types';

const TIMEOUT_MS = 6000;

function decide(
  discount: number,
  retail: number,
): { decision: WishlistDecisionItem['decision']; reasonCodes: string[] } {
  const reasons: string[] = [];
  if (discount > 0 && discount <= 10 && retail >= 20) {
    reasons.push('low_priority');
    return { decision: 'skip_for_now', reasonCodes: reasons };
  }
  if (discount >= 55) {
    reasons.push('deep_discount');
    return { decision: 'buy_now', reasonCodes: reasons };
  }
  if (discount >= 35) {
    reasons.push('solid_discount');
    return { decision: 'buy_now', reasonCodes: reasons };
  }
  if (discount <= 12 && retail > 15) {
    reasons.push('shallow_discount');
    return { decision: 'wait', reasonCodes: reasons };
  }
  if (discount <= 20) {
    reasons.push('could_go_lower');
    return { decision: 'wait', reasonCodes: reasons };
  }
  reasons.push('fair_price');
  return { decision: 'watch', reasonCodes: reasons };
}

export class WishlistDecisionsService {
  private fav = new FavoritesRepository();

  constructor(_env: Env) {}

  async listDecisions(userId: string): Promise<WishlistDecisionsResponse> {
    const favorites = await this.fav.listFavorites(userId);
    const items: WishlistDecisionItem[] = [];

    for (const f of favorites) {
      const appid = String(f.appid ?? '').trim();
      if (!appid) continue;

      const g = await fetchGameBySteamAppId(appid, TIMEOUT_MS);
      const dealId = g?.cheapestDealID ? String(g.cheapestDealID) : '';

      let sale = 0;
      let retail = 0;
      let discount = 0;
      let title = String(f.name ?? '');
      let thumb = String(f.headerImage ?? '');

      if (dealId) {
        const info = await fetchDealGameInfo(dealId, TIMEOUT_MS);
        if (info) {
          sale = info.salePrice;
          retail = info.retailPrice;
          discount = info.discountPercent;
          if (info.title) title = info.title;
          if (info.thumb) thumb = info.thumb;
        }
      }

      if (retail <= 0 && sale > 0) {
        retail = sale;
        discount = 0;
      }

      let decision: WishlistDecisionItem['decision'] = 'watch';
      let reasonCodes: string[] = ['price_unavailable'];

      if (retail > 0 && discount >= 0) {
        const d = decide(discount, retail);
        decision = d.decision;
        reasonCodes = d.reasonCodes;
      } else if (sale > 0) {
        decision = 'watch';
        reasonCodes = ['check_steam_store'];
      }

      items.push({
        appid,
        name: title,
        headerImage: thumb,
        decision,
        reasonCodes,
        currentPrice: sale,
        originalPrice: retail,
        discountPercent: discount,
        dealId: dealId || undefined,
      });
    }

    return { items };
  }
}
