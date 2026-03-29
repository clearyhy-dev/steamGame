import type { Env } from '../../config/env';
import express from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { WishlistController } from './wishlist.controller';

export function wishlistRouter(env: Env) {
  const r = express.Router();
  const c = new WishlistController(env);
  r.get('/decisions', authMiddleware(env), c.decisions);
  return r;
}
