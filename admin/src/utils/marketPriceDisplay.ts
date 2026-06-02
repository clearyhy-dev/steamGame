import type { MarketPlatformPriceCell } from '../types';

const INT_LIKE = new Set(['JPY', 'KRW', 'VND', 'CLP', 'IDR', 'HUF', 'ISK', 'UGX']);

export function formatPlatformAmount(
  amount: number | null | undefined,
  currency: string | null | undefined,
  currencySymbol?: string,
): string {
  if (amount == null) return '—';
  if (amount === 0) return '免费';
  const c = String(currency ?? '').trim().toUpperCase();
  const frac = INT_LIKE.has(c) ? 0 : 2;
  const sym = currencySymbol?.trim();
  const num = amount.toFixed(frac);
  if (sym) return `${sym}${num}`;
  if (c) return `${num} ${c}`;
  return num;
}

export function formatPriceRange(
  cell: MarketPlatformPriceCell | null | undefined,
  fallbackSymbol?: string,
): string {
  if (!cell) return '—';
  const sym = fallbackSymbol;
  const orig = formatPlatformAmount(cell.originalPrice, cell.currency, sym);
  const fin = formatPlatformAmount(cell.finalPrice, cell.currency, sym);
  if (orig === '—' && fin === '—') return '—';
  if (orig === fin || orig === '—') return fin;
  if (fin === '—') return orig;
  return `${orig} → ${fin}`;
}

export function discountTag(v: number | null | undefined): string {
  if (v == null || v <= 0) return '—';
  return `-${Math.round(v)}%`;
}
