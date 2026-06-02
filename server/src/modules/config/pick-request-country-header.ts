import type { Request } from 'express';

/** CDN / 边缘可能注入的国别头（无 GeoIP DB）。 */
export function pickCountryHeaderFromRequest(req: Request): string | null {
  const headers = req.headers as Record<string, unknown>;
  const pick = (v: unknown): string => {
    if (typeof v !== 'string' || !v.trim()) return '';
    return v.trim();
  };
  const raw =
    pick(headers['cloudfront-viewer-country']) ||
    pick(headers['cf-ipcountry']) ||
    pick(headers['x-appengine-country']) ||
    pick(headers['x-vercel-ip-country']);
  if (/^[a-z]{2}$/i.test(raw)) return raw.toUpperCase();
  return null;
}
