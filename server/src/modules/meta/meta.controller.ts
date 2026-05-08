import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { getEffectiveEnv } from '../../config/runtime-config';

type EndpointRow = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  authRequired: boolean;
  scope: 'app_backend' | 'app_public' | 'admin' | 'third_party';
  name: string;
  usedBy?: string[];
  notes?: string;
};

/**
 * Diagnostics metadata for clients / admins.
 * Note: this is intentionally **read-only** metadata for troubleshooting.
 * Do NOT make endpoint paths dynamically configurable.
 */
export class MetaController {
  constructor(private env: Env) {}

  endpoints = async (_req: Request, res: Response): Promise<void> => {
    const e = await getEffectiveEnv(this.env);
    const apiBaseUrl = String(e.appBaseUrl ?? '').trim().replace(/\/+$/, '');

    const endpoints: EndpointRow[] = [
      // Client bootstrap / config
      {
        method: 'GET',
        path: '/api/config',
        authRequired: false,
        scope: 'app_public',
        name: 'Client config (bootstrap)',
        usedBy: ['AppRemoteConfig.loadFromBackend'],
      },
      {
        method: 'GET',
        path: '/v1/config/client-region',
        authRequired: false,
        scope: 'app_public',
        name: 'Client region guess (headers)',
        usedBy: ['ClientRegionClient.fetchGuess'],
      },
      {
        method: 'GET',
        path: '/api/v1/config/countries',
        authRequired: false,
        scope: 'app_public',
        name: 'Country catalog (enabled countries)',
        usedBy: ['CountryCatalogService.load'],
      },

      // Recommendations
      {
        method: 'GET',
        path: '/v1/recommendations/home',
        authRequired: true,
        scope: 'app_backend',
        name: 'Home recommendations',
        usedBy: ['Home / Explore bootstrap'],
      },
      {
        method: 'GET',
        path: '/v1/recommendations/explore?tab=trending|for_you|deep|hidden',
        authRequired: true,
        scope: 'app_backend',
        name: 'Explore tab recommendations',
        usedBy: ['ExplorePage._loadExploreTab'],
      },
      {
        method: 'GET',
        path: '/v1/recommendations/trending-public',
        authRequired: false,
        scope: 'app_public',
        name: 'Trending public recommendations (no auth)',
        usedBy: ['ExplorePage._load fallback'],
      },

      // Steam aggregated data
      {
        method: 'POST',
        path: '/api/steam/sync',
        authRequired: true,
        scope: 'app_backend',
        name: 'Request Steam sync',
        usedBy: ['SteamOverviewPage / SteamAccountPage'],
      },
      {
        method: 'GET',
        path: '/api/steam/overview',
        authRequired: true,
        scope: 'app_backend',
        name: 'Steam overview (aggregated)',
        usedBy: ['SteamOverviewPage'],
      },
      {
        method: 'GET',
        path: '/api/steam/games/owned',
        authRequired: true,
        scope: 'app_backend',
        name: 'Steam owned games (cached/aggregated)',
        usedBy: ['SteamOwnedGamesPage'],
      },
      {
        method: 'GET',
        path: '/api/steam/games/recent',
        authRequired: true,
        scope: 'app_backend',
        name: 'Steam recent games (cached/aggregated)',
        usedBy: ['SteamRecentGamesPage'],
      },
      {
        method: 'GET',
        path: '/api/steam/friends/status',
        authRequired: true,
        scope: 'app_backend',
        name: 'Steam friends status (cached/aggregated)',
        usedBy: ['SteamFriendsPage'],
      },

      // Favorites (server-side)
      {
        method: 'GET',
        path: '/api/favorites',
        authRequired: true,
        scope: 'app_backend',
        name: 'List favorites',
        usedBy: ['SteamFavoritesPage / repository'],
      },
      {
        method: 'POST',
        path: '/api/favorites',
        authRequired: true,
        scope: 'app_backend',
        name: 'Add favorite',
        usedBy: ['SteamOwnedGamesPage addFavorite'],
      },
      {
        method: 'DELETE',
        path: '/api/favorites/:appid',
        authRequired: true,
        scope: 'app_backend',
        name: 'Remove favorite',
        usedBy: ['SteamFavoritesPage removeFavorite'],
      },

      // Games (public)
      {
        method: 'GET',
        path: '/api/v1/games/:appid/regional-detail',
        authRequired: false,
        scope: 'app_public',
        name: 'Game regional detail (Steam formatted + deals)',
        usedBy: ['GameDetailPage'],
      },
      {
        method: 'GET',
        path: '/api/v1/games/:appid/steam-price',
        authRequired: false,
        scope: 'app_public',
        name: 'Steam regional store price',
        usedBy: ['regional pricing'],
      },
      {
        method: 'GET',
        path: '/api/games/:appid/deals',
        authRequired: false,
        scope: 'app_public',
        name: 'Deals list (multi-source)',
        usedBy: ['GameDetailPage'],
        notes: 'May retry anonymously if auth call fails',
      },
      {
        method: 'GET',
        path: '/api/games/:appid/discount-link',
        authRequired: false,
        scope: 'app_public',
        name: 'Best discount link (affiliate)',
        usedBy: ['GameDetailPage buy button'],
      },
      {
        method: 'POST',
        path: '/api/games/:appid/ensure-meta',
        authRequired: true,
        scope: 'app_backend',
        name: 'Ensure game metadata',
        usedBy: ['Detail prefetch'],
      },
      {
        method: 'POST',
        path: '/api/games/:appid/refresh-deals',
        authRequired: true,
        scope: 'app_backend',
        name: 'Refresh deals cache',
        usedBy: ['Admin / debug'],
      },

      // Stats / share
      {
        method: 'GET',
        path: '/v1/stats/summary',
        authRequired: true,
        scope: 'app_backend',
        name: 'Stats summary',
        usedBy: ['Home/Profile'],
      },
      {
        method: 'GET',
        path: '/v1/stats/share-card',
        authRequired: true,
        scope: 'app_backend',
        name: 'Share card',
        usedBy: ['Profile share card'],
      },

      // Events mirror
      {
        method: 'POST',
        path: '/v1/events/:path',
        authRequired: true,
        scope: 'app_backend',
        name: 'Analytics mirror',
        usedBy: ['AnalyticsService._mirror'],
      },

      // Admin (not used by mobile app)
      {
        method: 'GET',
        path: '/api/admin/*',
        authRequired: true,
        scope: 'admin',
        name: 'Admin APIs',
        usedBy: ['Admin dashboard'],
        notes: 'Mobile app does NOT call these routes',
      },

      // Third party (client direct, not via backend)
      {
        method: 'GET',
        path: 'https://www.cheapshark.com/api/1.0/*',
        authRequired: false,
        scope: 'third_party',
        name: 'CheapShark public API',
        usedBy: ['SteamApiService'],
      },
      {
        method: 'GET',
        path: 'https://store.steampowered.com/*',
        authRequired: false,
        scope: 'third_party',
        name: 'Steam store (appdetails/appreviews)',
        usedBy: ['SteamApiService'],
      },
      {
        method: 'GET',
        path: 'https://api.isthereanydeal.com/*',
        authRequired: false,
        scope: 'third_party',
        name: 'IsThereAnyDeal',
        usedBy: ['SteamApiService.fetchPriceHistoryFromItad'],
      },
    ];

    res.status(200).json({
      success: true,
      data: {
        apiBaseUrl,
        generatedAt: new Date().toISOString(),
        endpoints,
      },
    });
  };
}

