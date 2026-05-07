import { describe, expect, it } from 'vitest';
import { extractItadDealPriceDisplay, formatItadMoneyAmount } from './itad-deals.client';

/** Sample shape from ITAD `/deals/v2` docs (Steam shop row). */
const FIXTURE_LIST_ITEM = {
  id: '018d937e-e9ce-718b-9715-111f50820ed4',
  title: 'Sample',
  deal: {
    shop: { id: 61, name: 'Steam' },
    price: { amount: 9.99, amountInt: 999, currency: 'USD' },
    regular: { amount: 39.99, amountInt: 3999, currency: 'USD' },
    cut: 75,
  },
};

describe('ITAD deals/v2 deal.price shape', () => {
  it('extracts formatted sale/regular using amount + currency', () => {
    const deal = FIXTURE_LIST_ITEM.deal as Record<string, unknown>;
    const row = extractItadDealPriceDisplay(deal);
    expect(row).not.toBeNull();
    expect(row!.currency).toBe('USD');
    expect(row!.saleFormatted).toContain('9.99');
    expect(row!.regularFormatted).toContain('39.99');
  });

  it('formats JPY without fractional digits', () => {
    expect(formatItadMoneyAmount(1200, 'JPY')).toMatch(/1[,.]?200/);
  });
});
