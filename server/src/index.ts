import { loadEnv } from './config/env';
import { createApp } from './app';
import { logger } from './utils/logger';
import { startVideoWorker } from './modules/video/video.worker';
import { startSteamSyncWorker } from './modules/steam/steam-sync.worker';

async function main() {
  const env = loadEnv();
  if (!String(env.steamApiKey ?? '').trim()) {
    logger.warn('STEAM_API_KEY is empty in env; set it or configure in Admin → Settings → 运行时 (Firestore).');
  }
  const app = createApp(env);

  startVideoWorker(env);
  startSteamSyncWorker(env);

  const port = env.port;
  app.listen(port, '0.0.0.0', () => {
    logger.info(`Server listening on 0.0.0.0:${port} (env=${env.nodeEnv})`);
  });
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

