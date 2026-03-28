import type { Env } from '../config/env';
import express from 'express';

import { authRouter } from '../modules/auth/auth.routes';
import { usersRouter } from '../modules/users/users.routes';
import { steamRouter } from '../modules/steam/steam.routes';
import { favoritesRouter } from '../modules/favorites/favorites.routes';

export function createRouter(env: Env) {
  const r = express.Router();

  r.use('/auth', authRouter(env));
  r.use('/api', usersRouter(env));
  r.use('/api/steam', steamRouter(env));
  r.use('/api/favorites', favoritesRouter(env));

  return r;
}

