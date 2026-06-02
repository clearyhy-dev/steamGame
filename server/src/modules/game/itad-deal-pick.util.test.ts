import { describe, expect, it } from 'vitest';
import { itadDealToPriceFields, pickItadDealFromPricesV3Entry } from './itad-deal-pick.util';

/** ITAD prices/v3 文档示例结构（简化） */
const PRICES_V3_ENTRY = {
  id: '018d937f-012f-73b8-ab2c-898516969e6a',
  deals: [
    {
      shop: { id: 50, name: 'Nuuvem' },
      price: { amount: 8177, currency: 'ARS' },
      regular: { amount: 8177, currency: 'ARS' },
      cut: 0,
      url: 'https://itad.link/nuuvem-full/',
    },
    {
      shop: { id: 61, name: 'Steam' },
      price: { amount: 5.79, currency: 'ARS' },
      regular: { amount: 23.99, currency: 'ARS' },
      cut: 76,
      url: 'https://itad.link/steam-deal/',
    },
  ],
};

describe('pickItadDealFromPricesV3Entry', () => {
  it('picks lowest final price for country (not first deal)', () => {
    const deal = pickItadDealFromPricesV3Entry(PRICES_V3_ENTRY);
    expect(deal).not.toBeNull();
    const fields = itadDealToPriceFields(deal!);
    expect(fields.finalPrice).toBe(5.79);
    expect(fields.currency).toBe('ARS');
    expect(String(deal!.url)).toContain('itad.link/steam-deal');
  });
});
