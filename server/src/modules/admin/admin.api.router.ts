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
import { AdminRegionCountriesController } from './admin.region-countries.controller';
import { AdminRequestLogsController } from './admin.request-logs.controller';
import { AdminMetaController } from './admin.meta.controller';
import { AdminScheduledTasksController } from './admin.scheduled-tasks.controller';
import { AdminSqliteDbController } from './admin.sqlite-db.controller';
import { AdminInfrastructureController } from './admin.infrastructure.controller';
import { AdminMarketController } from '../market/admin.market.controller';

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
  const regionCountries = new AdminRegionCountriesController();
  const requestLogs = new AdminRequestLogsController();
  const meta = new AdminMetaController(env);
  const scheduledTasks = new AdminScheduledTasksController(env);
  const sqliteDb = new AdminSqliteDbController(env);
  const infrastructure = new AdminInfrastructureController(env);
  const markets = new AdminMarketController(env);

  router.post('/auth/login', asyncHandler(auth.login));

  const secured = express.Router();
  secured.use(adminAuthMiddleware(env));

  secured.get('/auth/me', asyncHandler(auth.me));
  secured.post('/auth/logout', asyncHandler(auth.logout));

  secured.get('/dashboard/stats', asyncHandler(dashboard.stats));
  secured.get('/request-logs', asyncHandler(requestLogs.list));
  secured.get('/meta/endpoints', asyncHandler(meta.endpoints));
  secured.get('/settings/discount-providers', asyncHandler(settings.getDiscountProviders));
  secured.patch('/settings/discount-providers', asyncHandler(settings.patchDiscountProviders));
  secured.get('/settings/runtime', asyncHandler(settings.getRuntime));
  secured.patch('/settings/runtime', asyncHandler(settings.patchRuntime));
  secured.get('/settings/infrastructure', asyncHandler(infrastructure.getConfig));
  secured.get('/settings/infrastructure/minio/objects', asyncHandler(infrastructure.browseMinio));
  secured.get('/settings/infrastructure/redis', asyncHandler(infrastructure.browseRedis));
  secured.post(
    '/settings/infrastructure/rebuild-price-sync-index',
    asyncHandler(infrastructure.rebuildPriceSyncIndex),
  );

  secured.get('/scheduled-tasks', asyncHandler(scheduledTasks.list));
  secured.put('/scheduled-tasks', asyncHandler(scheduledTasks.save));
  secured.post('/scheduled-tasks/run-all-enabled', asyncHandler(scheduledTasks.runAllEnabled));
  secured.post('/scheduled-tasks/emergency-stop', asyncHandler(scheduledTasks.emergencyStop));
  secured.post('/scheduled-tasks/:taskId/run', asyncHandler(scheduledTasks.runNow));

  secured.get('/sqlite/info', asyncHandler(sqliteDb.info));
  secured.get('/sqlite/tables', asyncHandler(sqliteDb.listTables));
  secured.get('/sqlite/tables/:table/schema', asyncHandler(sqliteDb.schema));
  secured.get('/sqlite/tables/:table/rows', asyncHandler(sqliteDb.rows));
  secured.patch('/sqlite/tables/:table/rows', asyncHandler(sqliteDb.updateRow));

  secured.get('/region-countries/provider-meta', asyncHandler(regionCountries.providerMeta));
  secured.get('/region-countries/sync-tier-settings', asyncHandler(regionCountries.getSyncTierSettings));
  secured.put('/region-countries/sync-tier-settings', asyncHandler(regionCountries.saveSyncTierSettings));
  secured.post('/region-countries/sync-tier-reset-defaults', asyncHandler(regionCountries.resetSyncTiersToDefault));
  secured.get('/region-countries', asyncHandler(regionCountries.list));
  secured.post('/region-countries', asyncHandler(regionCountries.upsert));
  secured.post('/region-countries/sync-provider-codes', asyncHandler(regionCountries.syncProviderCodesFromSteam));
  secured.patch('/region-countries/:countryCode/enabled', asyncHandler(regionCountries.patchEnabled));
  secured.patch('/region-countries/:countryCode/sync-tier', asyncHandler(regionCountries.patchSyncTier));

  secured.get('/markets/sync-status', asyncHandler(markets.syncStatus));
  secured.get('/markets/shard-sync-status', asyncHandler(markets.shardSyncStatus));
  secured.post('/markets/stale-discounts/cleanup', asyncHandler(markets.runStaleDiscountCleanup));
  secured.post('/markets/daily-full-sync/run', asyncHandler(markets.runDailyFullSync));
  secured.post('/markets/daily-sharded-sync/run', asyncHandler(markets.runDailyShardedFullSync));
  secured.post('/markets/round-robin/run', asyncHandler(markets.runRoundRobin));
  secured.post('/markets/round-robin/run-shard', asyncHandler(markets.runRoundRobinShard));
  secured.get('/markets/:cc/stats', asyncHandler(markets.countryStats));
  secured.get('/markets/:cc/games', asyncHandler(markets.listGames));
  secured.get('/markets/:cc/games/:appid', asyncHandler(markets.getGame));
  secured.post('/markets/:cc/games/:appid/sync', asyncHandler(markets.syncOne));

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
  secured.post('/games/backfill-trailer-videos', asyncHandler(games.backfillTrailerVideos));
  secured.post('/games/dedupe-trailer-videos', asyncHandler(games.dedupeTrailerVideos));
  secured.get('/games/sync-jobs', asyncHandler(games.listSyncJobs));
  secured.get('/games/:appid', asyncHandler(games.getOne));
  secured.post('/games/:appid/sync-detail', asyncHandler(games.syncDetailOne));
  secured.post('/games/:appid/sync-deals', asyncHandler(games.syncDeals));
  secured.post('/games/sync-deals-batch', asyncHandler(games.syncDealsBatch));
  secured.post('/games/sync-deals-hot-top', asyncHandler(games.syncDealsHotTop));
  secured.post('/games/deals/full-reset-resync', asyncHandler(games.fullResetResyncDealsToday));
  secured.post('/games/sync-weekly-heat', asyncHandler(games.syncWeeklyHeatPage));
  secured.post('/games/sync-top-heat-pipeline', asyncHandler(games.syncTopHeatPipeline));
  secured.post('/games/:appid/sync-meta', asyncHandler(games.syncMeta));
  secured.post('/games/:appid/load-reviews', asyncHandler(games.loadReviews));
  secured.get('/games/:appid/deal-links', asyncHandler(games.listDealLinks));
  secured.post('/games/:appid/deal-links', asyncHandler(games.upsertDealLink));
  secured.patch('/games/:appid/deal-links/:dealId', asyncHandler(games.upsertDealLink));

  secured.get('/users', asyncHandler(users.list));
  secured.get('/users/:userId/favorites', asyncHandler(users.getFavorites));
  secured.patch('/users/:userId', asyncHandler(users.patch));

  router.use(secured);
  return router;
}
