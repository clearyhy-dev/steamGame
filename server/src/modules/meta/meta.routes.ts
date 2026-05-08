import type { Env } from '../../config/env';
import express from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { MetaController } from './meta.controller';

/** Mount at `/v1/meta` */
export function metaRouter(env: Env) {
  const r = express.Router();
  const c = new MetaController(env);
  r.get('/endpoints', asyncHandler(c.endpoints));
  return r;
}

