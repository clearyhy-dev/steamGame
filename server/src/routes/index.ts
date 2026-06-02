import type { Env } from '../config/env';
import express from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { PublicConfigController } from '../modules/config/public.config.controller';
import { PublicRegionCountriesController } from '../modules/config/public.region-countries.controller';

import { authRouter } from '../modules/auth/auth.routes';
import { usersRouter } from '../modules/users/users.routes';
import { steamRouter } from '../modules/steam/steam.routes';
import { favoritesRouter } from '../modules/favorites/favorites.routes';
import { recommendationsRouter } from '../modules/recommendations/recommendations.routes';
import { wishlistRouter } from '../modules/wishlist/wishlist.routes';
import { statsRouter } from '../modules/stats/stats.routes';
import { eventsRouter } from '../modules/events/events.routes';
import { steamV1Router } from '../modules/steam/steam.v1.routes';
import { metaRouter } from '../modules/meta/meta.routes';
import { createAdminApiRouter } from '../modules/admin/admin.api.router';
import { AdminGamesController } from '../modules/admin/admin.games.controller';
import { createPublicVideosRouter } from '../modules/video/public.videos.routes';
import { createPublicGamesRouter } from '../modules/game/public.games.routes';
import { createPublicMarketRouter } from '../modules/market/public.market.routes';
import { runCacheBuild } from '../jobs/cacheBuilder';
import swaggerUi from 'swagger-ui-express';
import { buildOpenApiSpec } from '../modules/meta/openapi';
import { httpSafePublicCacheMiddleware } from '../middlewares/httpCache.middleware';

export function createRouter(env: Env) {
  const r = express.Router();
  r.use(httpSafePublicCacheMiddleware());

  const publicConfig = new PublicConfigController(env);
  const publicRegionCountries = new PublicRegionCountriesController();
  r.get('/api/config', asyncHandler(publicConfig.getClientConfig));

  // Swagger UI (read-only docs). We generate an OpenAPI skeleton from known endpoints.
  // Served before auth routes so it is always accessible.
  r.get(
    '/api/openapi.json',
    asyncHandler(async (_req, res) => {
      const spec = await buildOpenApiSpec(env);
      // 标准 OpenAPI 文档：外部工具（Postman、网关）需原始 JSON，勿再包一层 envelope。
      res.status(200).setHeader('Content-Type', 'application/json').json(spec);
    }),
  );
  r.use(
    '/api/docs',
    swaggerUi.serve,
    // Use async handler to resolve env baseUrl at request time (runtime-config may change).
    asyncHandler(async (_req, res) => {
      const spec = await buildOpenApiSpec(env);
      const setup = swaggerUi.setup(spec, {
        explorer: true,
        customCss: '.swagger-ui .opblock .body-param__example { max-height: none; }',
        swaggerOptions: {
          docExpansion: 'full',
          filter: true,
          persistAuthorization: true,
          displayRequestDuration: true,
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (setup as any)(_req, res);
    }),
  );

  r.use('/auth', authRouter(env));

  r.post(
    '/api/internal/cron/daily-schedules',
    asyncHandler(async (req, res) => {
      if (!env.backgroundWorkersEnabled) {
        res.status(503).json({ success: false, error: 'Background workers disabled' });
        return;
      }
      const secret = env.cronSecret?.trim();
      if (!secret) {
        res.status(503).json({ success: false, error: 'CRON_SECRET not configured' });
        return;
      }
      if (String(req.get('x-cron-secret') ?? '').trim() !== secret) {
        res.status(401).json({ success: false, error: 'unauthorized' });
        return;
      }
      const { runAllEnabledScheduledTasks } = await import('../modules/admin/scheduled-tasks.runner');
      const results = await runAllEnabledScheduledTasks(env);
      res.json({ success: true, mode: 'cron_daily_schedules', results });
    }),
  );

  r.post(
    '/api/internal/cron/daily-deal-schedules',
    asyncHandler(async (req, res) => {
      if (!env.backgroundWorkersEnabled) {
        res.status(503).json({ success: false, error: 'Background workers disabled' });
        return;
      }
      const secret = env.cronSecret?.trim();
      if (!secret) {
        res.status(503).json({ success: false, error: 'CRON_SECRET not configured' });
        return;
      }
      if (String(req.get('x-cron-secret') ?? '').trim() !== secret) {
        res.status(401).json({ success: false, error: 'unauthorized' });
        return;
      }
      const { runAllEnabledDealScheduledTasks } = await import('../modules/admin/scheduled-tasks.runner');
      const results = await runAllEnabledDealScheduledTasks(env);
      res.json({ success: true, mode: 'cron_daily_deal_schedules', results });
    }),
  );

  r.post(
    '/api/internal/cron/daily-deals',
    asyncHandler(async (req, res) => {
      if (!env.backgroundWorkersEnabled) {
        res.status(503).json({ success: false, error: 'Background workers disabled' });
        return;
      }
      const secret = env.cronSecret?.trim();
      if (!secret) {
        res.status(503).json({ success: false, error: 'CRON_SECRET not configured' });
        return;
      }
      if (String(req.get('x-cron-secret') ?? '').trim() !== secret) {
        res.status(401).json({ success: false, error: 'unauthorized' });
        return;
      }
      const games = new AdminGamesController(env);
      await games.runDailyDealsCron(req, res);
    }),
  );

  r.post(
    '/api/internal/cron/top-heat-pipeline',
    asyncHandler(async (req, res) => {
      if (!env.backgroundWorkersEnabled) {
        res.status(503).json({ success: false, error: 'Background workers disabled' });
        return;
      }
      const secret = env.cronSecret?.trim();
      if (!secret) {
        res.status(503).json({ success: false, error: 'CRON_SECRET not configured' });
        return;
      }
      if (String(req.get('x-cron-secret') ?? '').trim() !== secret) {
        res.status(401).json({ success: false, error: 'unauthorized' });
        return;
      }
      const games = new AdminGamesController(env);
      await games.runTopHeatPipelineCron(req, res);
    }),
  );

  r.post(
    '/api/internal/cron/weekly-heat',
    asyncHandler(async (req, res) => {
      if (!env.backgroundWorkersEnabled) {
        res.status(503).json({ success: false, error: 'Background workers disabled' });
        return;
      }
      const secret = env.cronSecret?.trim();
      if (!secret) {
        res.status(503).json({ success: false, error: 'CRON_SECRET not configured' });
        return;
      }
      if (String(req.get('x-cron-secret') ?? '').trim() !== secret) {
        res.status(401).json({ success: false, error: 'unauthorized' });
        return;
      }
      const games = new AdminGamesController(env);
      await games.runWeeklyHeatCron(req, res);
    }),
  );

  r.post(
    '/api/internal/cron/build-cache',
    asyncHandler(async (req, res) => {
      if (!env.backgroundWorkersEnabled) {
        res.status(503).json({ success: false, error: 'Background workers disabled' });
        return;
      }
      const secret = env.cronSecret?.trim();
      if (!secret) {
        res.status(503).json({ success: false, error: 'CRON_SECRET not configured' });
        return;
      }
      if (String(req.get('x-cron-secret') ?? '').trim() !== secret) {
        res.status(401).json({ success: false, error: 'unauthorized' });
        return;
      }
      const out = await runCacheBuild(env);
      res.status(200).json({ success: true, data: out });
    }),
  );

  r.use('/api/admin', createAdminApiRouter(env));
  r.use('/api/videos', createPublicVideosRouter(env));
  r.use('/api/games', createPublicGamesRouter(env));
  r.use('/api/v2/markets', createPublicMarketRouter(env));
  r.use('/api', usersRouter(env));
  r.use('/api/steam', steamRouter(env));
  r.use('/api/favorites', favoritesRouter(env));

  const v1 = express.Router();
  v1.get('/config/countries', asyncHandler(publicRegionCountries.getCountries));
  v1.use('/recommendations', recommendationsRouter(env));
  v1.use('/games', createPublicGamesRouter(env));
  v1.use('/wishlist', wishlistRouter(env));
  v1.use('/stats', statsRouter(env));
  v1.use('/events', eventsRouter(env));
  v1.use('/steam', steamV1Router(env));
  v1.use('/meta', metaRouter(env));
  r.use('/v1', v1);
  r.use('/api/v1', v1);

  return r;
}

