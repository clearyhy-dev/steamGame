const fs = require("fs");
const s = `import type { Env } from '../../config/env';
import express from 'express';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { SteamController } from './steam.controller';
import { UsersController } from '../users/users.controller';

/** v1 Steam aliases; delegates to existing /api handlers. */
export function steamV1Router(env: Env) {
  const r = express.Router();
  const steam = new SteamController(env);
  const users = new UsersController(env);
  r.get('/me', authMiddleware(env), users.me);
  r.get('/library', authMiddleware(env), steam.gamesOwned);
  r.get('/recently-played', authMiddleware(env), steam.gamesRecent);
  return r;
}
`;
fs.writeFileSync("d:/googleplay/steamgame/steamGame/server/src/modules/steam/steam.v1.routes.ts", s);
