import type { Env } from '../../config/env';
import express from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { EventsController } from './events.controller';

export function eventsRouter(env: Env) {
  const r = express.Router();
  const c = new EventsController(env);
  r.post('/exposure', authMiddleware(env), c.exposure);
  r.post('/click', authMiddleware(env), c.click);
  r.post('/conversion', authMiddleware(env), c.conversion);
  return r;
}
