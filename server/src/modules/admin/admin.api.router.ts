import type { Env } from '../../config/env';
import express from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { adminAuthMiddleware } from './adminAuth.middleware';
import { AdminAuthController } from './admin.auth.controller';
import { AdminDashboardController } from './admin.dashboard.controller';
import { AdminVideoSourcesController } from './admin.video-sources.controller';
import { AdminVideosController } from './admin.videos.controller';
import { AdminVideoJobsController } from './admin.video-jobs.controller';
import { AdminSteamGamesController } from './admin.steam-games.controller';
import { AdminUsersController } from './admin.users.controller';
import { AdminGamesController } from './admin.games.controller';
import { AdminSettingsController } from './admin.settings.controller';

/** Mount at `/api/admin` — routes below are relative (e.g. `/auth/login`). */
export function createAdminApiRouter(env: Env) {
  const router = express.Router();

  const auth = new AdminAuthController(env);
  const dashboard = new AdminDashboardController(env);
  const sources = new AdminVideoSourcesController(env);
  const videos = new AdminVideosController(env);
  const jobs = new AdminVideoJobsController(env);
  const steamGames = new AdminSteamGamesController(env);
  const users = new AdminUsersController(env);
  const games = new AdminGamesController(env);
  const settings = new AdminSettingsController(env);

  router.post('/auth/login', asyncHandler(auth.login));

  const secured = express.Router();
  secured.use(adminAuthMiddleware(env));

  secured.get('/auth/me', asyncHandler(auth.me));
  secured.post('/auth/logout', asyncHandler(auth.logout));

  secured.get('/dashboard/stats', asyncHandler(dashboard.stats));
  secured.get('/settings/discount-providers', asyncHandler(settings.getDiscountProviders));
  secured.patch('/settings/discount-providers', asyncHandler(settings.patchDiscountProviders));
  secured.get('/settings/runtime', asyncHandler(settings.getRuntime));
  secured.patch('/settings/runtime', asyncHandler(settings.patchRuntime));

  secured.get('/video-sources', asyncHandler(sources.list));
  secured.post('/video-sources/youtube', asyncHandler(sources.createYoutube));
  secured.post('/video-sources/steam', asyncHandler(sources.createSteam));
  secured.patch('/video-sources/:sourceId', asyncHandler(sources.patch));
  secured.post('/video-sources/:sourceId/ingest', asyncHandler(sources.ingest));
  secured.get('/video-sources/:sourceId', asyncHandler(sources.getOne));

  secured.get('/videos', asyncHandler(videos.list));
  secured.get('/videos/:videoId', asyncHandler(videos.getOne));
  secured.post('/videos/:videoId/publish', asyncHandler(videos.publish));
  secured.post('/videos/:videoId/unpublish', asyncHandler(videos.unpublish));
  secured.post('/videos/:videoId/reprocess', asyncHandler(videos.reprocess));

  secured.get('/video-jobs', asyncHandler(jobs.list));
  secured.post('/video-jobs/:jobId/retry', asyncHandler(jobs.retry));

  secured.get('/steam-games', asyncHandler(steamGames.list));
  secured.post('/steam-users/:steamId/sync', asyncHandler(steamGames.syncOne));
  secured.get('/games', asyncHandler(games.list));
  secured.post('/games/sync-app-list', asyncHandler(games.syncAppList));
  secured.post('/games/sync-details', asyncHandler(games.syncDetailBatch));
  secured.get('/games/sync-jobs', asyncHandler(games.listSyncJobs));
  secured.get('/games/:appid', asyncHandler(games.getOne));
  secured.post('/games/:appid/sync-detail', asyncHandler(games.syncDetailOne));
  secured.post('/games/:appid/sync-deals', asyncHandler(games.syncDeals));
  secured.post('/games/sync-deals-batch', asyncHandler(games.syncDealsBatch));
  secured.post('/games/sync-deals-hot-top', asyncHandler(games.syncDealsHotTop));
  secured.post('/games/:appid/sync-meta', asyncHandler(games.syncMeta));
  secured.post('/games/:appid/load-reviews', asyncHandler(games.loadReviews));
  secured.patch('/games/:appid', asyncHandler(games.patch));
  secured.get('/games/:appid/deal-links', asyncHandler(games.listDealLinks));
  secured.post('/games/:appid/deal-links', asyncHandler(games.upsertDealLink));
  secured.patch('/games/:appid/deal-links/:dealId', asyncHandler(games.upsertDealLink));

  secured.get('/users', asyncHandler(users.list));
  secured.patch('/users/:userId', asyncHandler(users.patch));

  router.use(secured);
  return router;
}
