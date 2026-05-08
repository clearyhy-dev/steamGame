import type { Env } from '../../config/env';
import express from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import { MetaController } from './meta.controller';
import { buildOpenApiSpec } from './openapi';

/** Mount at `/v1/meta` */
export function metaRouter(env: Env) {
  const r = express.Router();
  const c = new MetaController(env);
  r.get('/endpoints', asyncHandler(c.endpoints));
  r.get(
    '/openapi.json',
    asyncHandler(async (_req, res) => {
      const spec = await buildOpenApiSpec(env);
      res.status(200).json({ success: true, data: spec });
    }),
  );
  return r;
}

