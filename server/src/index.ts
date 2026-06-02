import { loadEnv } from './config/env';
import { createApp } from './app';
import { logger } from './utils/logger';
import { startVideoWorker } from './modules/video/video.worker';
import { startScheduledTasksRunner } from './modules/admin/scheduled-tasks.runner';
import { ensureMarketV2Tables } from './storage/sqlite/ensure-market-schema';

async function main() {
  const env = loadEnv();
  if (!String(env.steamApiKey ?? '').trim()) {
    const cfgHint = env.dataStore === 'vultr_sqlite' ? '运行时 (SQLite)' : '运行时 (Firestore)';
    logger.warn(`STEAM_API_KEY is empty in env; set it or configure in Admin → Settings → ${cfgHint}.`);
  }
  if (env.dataStore === 'vultr_sqlite') {
    logger.info(`Data store: vultr_sqlite @ ${env.sqliteApiUrl} (Firestore reads disabled)`);
    try {
      await ensureMarketV2Tables();
    } catch (e) {
      logger.warn(`[market-schema] ensure failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const app = createApp(env);

  if (env.backgroundWorkersEnabled) {
    startVideoWorker(env);
    startScheduledTasksRunner(env);
    logger.info('Background workers: enabled (scheduled-tasks cron, video worker)');
  } else {
    logger.warn('Background workers: DISABLED (BACKGROUND_WORKERS_ENABLED=false). API-only mode.');
  }

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

