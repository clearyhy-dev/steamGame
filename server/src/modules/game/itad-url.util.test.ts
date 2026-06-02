import { describe, expect, it } from 'vitest';
import { isItadDealPurchaseUrl, itadDealPurchaseUrl, resolveItadOfferUrl } from '../game/itad-url.util';

describe('ITAD offer URL resolution', () => {
  it('detects itad.link purchase URLs from prices/v3', () => {
    const url = 'https://itad.link/018d9386-8be1-7319-8ecc-ab31d44c64d8/';
    expect(isItadDealPurchaseUrl(url)).toBe(true);
    expect(itadDealPurchaseUrl({ url })).toBe(url);
  });

  it('detects next.isthereanydeal.com/link purchase URLs', () => {
    const url = 'https://next.isthereanydeal.com/link/018d9386-7132-719b-89e1-e11b8c591ee7/';
    expect(isItadDealPurchaseUrl(url)).toBe(true);
  });

  it('prefers deal purchase link over game page', () => {
    const dealUrl = 'https://itad.link/abc/';
    const out = resolveItadOfferUrl({
      deal: { url: dealUrl },
      lookupData: { slug: 'half-life-2' },
      itadGameId: 'gid',
      steamAppid: '220',
    });
    expect(out).toBe(dealUrl);
  });

  it('falls back to slug game page when deal has no url', () => {
    const out = resolveItadOfferUrl({
      deal: { price: { amount: 9.99, currency: 'USD' } },
      lookupData: { slug: 'half-life-2' },
      itadGameId: 'gid',
      steamAppid: '220',
    });
    expect(out).toBe('https://isthereanydeal.com/game/half-life-2/');
  });
});
