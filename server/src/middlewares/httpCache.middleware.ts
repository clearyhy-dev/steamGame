import type { NextFunction, Request, Response } from 'express';

/**
 * 仅对「匿名可缓存」的 GET 路径设置 Cache-Control，避免误把推荐 home / 详情等可变异响应交给 CDN 长缓存。
 */
function isSafePublicCachePath(pathname: string): boolean {
  if (pathname === '/api/config') return true;
  if (pathname === '/v1/config/countries' || pathname === '/api/v1/config/countries') return true;

  if (/\/games\/catalog$/i.test(pathname)) return true;
  if (/\/games\/search$/i.test(pathname)) return true;
  if (/\/games\/popular-searches$/i.test(pathname)) return true;
  if (/\/games\/[^/]+\/steam-price$/i.test(pathname)) return true;

  if (/\/recommendations\/trending-public$/i.test(pathname)) return true;

  if (/\/meta\/endpoints$/i.test(pathname) || /\/meta\/openapi\.json$/i.test(pathname)) return true;

  return false;
}

function cacheControlForPath(path: string): string {
  if (path.includes('/recommendations/trending-public')) {
    return 'public, max-age=1800, s-maxage=1800';
  }
  if (path.includes('/config/countries')) {
    return 'public, max-age=1800, s-maxage=1800';
  }
  if (/\/games\/catalog$/i.test(path)) {
    return 'public, max-age=600, s-maxage=600, stale-while-revalidate=600';
  }
  if (/\/games\/search$/i.test(path) || /\/games\/popular-searches$/i.test(path)) {
    return 'public, max-age=600, s-maxage=600, stale-while-revalidate=300';
  }
  if (path.includes('/steam-price')) {
    return 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600';
  }
  if (path.includes('/meta/endpoints') || path.includes('/meta/openapi')) {
    return 'public, max-age=86400, s-maxage=86400';
  }
  return 'public, max-age=600, s-maxage=600';
}

/**
 * 挂在主 Router 上：仅对 allowlist 内的 GET 且不带 Authorization 的请求设置 CDN 友好 Cache-Control。
 */
export function httpSafePublicCacheMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== 'GET') {
      next();
      return;
    }
    const path = req.path || '';
    if (!isSafePublicCachePath(path)) {
      next();
      return;
    }
    if (String(req.header('Authorization') ?? '').trim().length > 0) {
      next();
      return;
    }
    res.setHeader('Cache-Control', cacheControlForPath(path));
    next();
  };
}
