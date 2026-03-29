import type { Env } from '../../config/env';
import express from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { RecommendationsController } from './recommendations.controller';

export function recommendationsRouter(env: Env) {
  const r = express.Router();
  const c = new RecommendationsController(env);
  r.get('/home', authMiddleware(env), c.home);
  r.get('/explore', authMiddleware(env), c.explore);
  return r;
}
