import type { FavoriteBaselinePrices, FavoritePlatformBaseline } from '../favorites/favorites.types';

export type WishlistAlertEmailItem = {
  appName: string;
  appid: string;
  headerImage?: string;
  baselineLowest: number;
  baselineCurrency: string;
  currentLowest: number;
  currentCurrency: string;
  savingsPercent: number;
  platforms: FavoriteBaselinePrices['platforms'];
};

export type WishlistAlertEmailParams = {
  appDisplayName: string;
  appIconUrl: string;
  appBaseUrl: string;
  deeplinkScheme: string;
  recipientName: string;
  countryCode: string;
  items: WishlistAlertEmailItem[];
};

function fmtPrice(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function platformRow(label: string, cell: FavoritePlatformBaseline | undefined, cta: string): string {
  if (!cell) {
    return `<tr><td style="padding:12px 0;color:#8f98a0;">${label}</td><td style="padding:12px 0;color:#8f98a0;">—</td><td></td></tr>`;
  }
  const price = fmtPrice(cell.finalPrice, cell.currency);
  const was =
    cell.originalPrice != null && cell.originalPrice > cell.finalPrice
      ? `<span style="color:#8f98a0;text-decoration:line-through;margin-right:8px;">${fmtPrice(cell.originalPrice, cell.currency)}</span>`
      : '';
  const disc =
    cell.discountPercent != null && cell.discountPercent > 0
      ? `<span style="color:#beee11;font-weight:700;">-${Math.round(cell.discountPercent)}%</span>`
      : '';
  const link = cell.url
    ? `<a href="${cell.url}" style="color:#66c0f4;text-decoration:none;font-weight:600;">${cta} →</a>`
    : '';
  return `<tr>
    <td style="padding:14px 0;color:#c7d5e0;font-weight:600;width:90px;">${label}</td>
    <td style="padding:14px 0;color:#ffffff;">${was}${price} ${disc}</td>
    <td style="padding:14px 0;text-align:right;">${link}</td>
  </tr>`;
}

export function renderWishlistPriceAlertEmail(params: WishlistAlertEmailParams): { subject: string; html: string; text: string } {
  const first = params.items[0];
  const subject = `[${params.appDisplayName}] ${first?.appName ?? 'A game'} is cheaper in your wishlist region`;
  const cards = params.items
    .map((item) => {
      const baseline = fmtPrice(item.baselineLowest, item.baselineCurrency);
      const current = fmtPrice(item.currentLowest, item.currentCurrency);
      const deepLink = `${params.deeplinkScheme}://game/${item.appid}`;
      const img = item.headerImage
        ? `<img src="${item.headerImage}" alt="" width="460" style="width:100%;max-width:460px;border-radius:4px;display:block;margin:0 0 12px;" />`
        : '';
      return `<div style="background:#1b2838;border:1px solid #2a475e;border-radius:8px;padding:16px;margin-bottom:16px;">
        ${img}
        <h2 style="margin:0 0 8px;color:#ffffff;font-size:20px;">${item.appName}</h2>
        <p style="margin:0 0 12px;color:#c7d5e0;">Was ${baseline} → now ${current} (${item.savingsPercent}% below your baseline)</p>
        <table style="width:100%;border-collapse:collapse;">
          ${platformRow('Steam', item.platforms.steam, 'View on Steam')}
          ${platformRow('ITAD', item.platforms.isthereanydeal, 'View deal')}
          ${platformRow('GG.deals', item.platforms.ggdeals, 'View deal')}
        </table>
        <p style="margin:16px 0 0;"><a href="${deepLink}" style="color:#66c0f4;">Open in app</a></p>
      </div>`;
    })
    .join('');

  const html = `<!DOCTYPE html><html><body style="margin:0;background:#171a21;font-family:Arial,Helvetica,sans-serif;">
    <div style="max-width:520px;margin:0 auto;padding:24px;">
      <div style="text-align:center;margin-bottom:20px;">
        <img src="${params.appIconUrl}" alt="" width="64" height="64" style="border-radius:12px;" />
      </div>
      <h1 style="color:#ffffff;font-size:22px;margin:0 0 8px;">Hi ${params.recipientName || 'there'},</h1>
      <p style="color:#c7d5e0;line-height:1.5;margin:0 0 20px;">
        Games on your wishlist are now cheaper than when you added them (${params.countryCode}).
      </p>
      ${cards}
      <p style="color:#8f98a0;font-size:12px;line-height:1.5;margin-top:24px;">
        You receive this email because you are a Pro subscriber with wishlist price alerts enabled.
      </p>
    </div>
  </body></html>`;

  const text = params.items
    .map((item) => {
      const lines = [
        `${item.appName}: ${fmtPrice(item.baselineLowest, item.baselineCurrency)} → ${fmtPrice(item.currentLowest, item.currentCurrency)}`,
        item.platforms.steam?.url ? `Steam: ${item.platforms.steam.url}` : '',
        item.platforms.isthereanydeal?.url ? `ITAD: ${item.platforms.isthereanydeal.url}` : '',
        item.platforms.ggdeals?.url ? `GG: ${item.platforms.ggdeals.url}` : '',
      ].filter(Boolean);
      return lines.join('\n');
    })
    .join('\n\n');

  return { subject, html, text };
}
