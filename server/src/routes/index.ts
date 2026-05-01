import type { Env } from '../config/env';
import express from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import { PublicConfigController } from '../modules/config/public.config.controller';
import { RegionSettingsController } from '../modules/config/region-settings.controller';

import { authRouter } from '../modules/auth/auth.routes';
import { usersRouter } from '../modules/users/users.routes';
import { steamRouter } from '../modules/steam/steam.routes';
import { favoritesRouter } from '../modules/favorites/favorites.routes';
import { recommendationsRouter } from '../modules/recommendations/recommendations.routes';
import { wishlistRouter } from '../modules/wishlist/wishlist.routes';
import { statsRouter } from '../modules/stats/stats.routes';
import { eventsRouter } from '../modules/events/events.routes';
import { steamV1Router } from '../modules/steam/steam.v1.routes';
import { createAdminApiRouter } from '../modules/admin/admin.api.router';
import { createPublicVideosRouter } from '../modules/video/public.videos.routes';
import { createPublicGamesRouter } from '../modules/game/public.games.routes';

export function createRouter(env: Env) {
  const r = express.Router();

  const publicConfig = new PublicConfigController(env);
  const regionSettings = new RegionSettingsController(env);
  r.get('/api/config', asyncHandler(publicConfig.getClientConfig));

  r.use('/auth', authRouter(env));
  r.use('/api/admin', createAdminApiRouter(env));
  r.use('/api/videos', createPublicVideosRouter(env));
  r.use('/api/games', createPublicGamesRouter(env));
  r.use('/api', usersRouter(env));
  r.use('/api/steam', steamRouter(env));
  r.use('/api/favorites', favoritesRouter(env));

  const v1 = express.Router();
  v1.get('/config/region-settings', asyncHandler(regionSettings.getRegionSettings));
  v1.use('/recommendations', recommendationsRouter(env));
  v1.use('/wishlist', wishlistRouter(env));
  v1.use('/stats', statsRouter(env));
  v1.use('/events', eventsRouter(env));
  v1.use('/steam', steamV1Router(env));
  r.use('/v1', v1);
  r.use('/api/v1', v1);

  return r;
}

