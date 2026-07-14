import express from 'express';
import type { AuthEnv } from './env';
import { AuthController } from './auth.controller';

export function createAuthRouter(env: AuthEnv): express.Router {
  const router = express.Router();
  const c = new AuthController(env);
  router.get('/health', c.health);
  router.get('/steam/start', c.startSteam);
  router.get('/steam/callback', c.callbackSteam);
  router.post('/introspect', express.json(), c.introspect);
  return router;
}
