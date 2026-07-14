import { loadEnv } from './config/env';
import { createApp } from './app';
import { logger } from './utils/logger';
import { startVideoWorker } from './modules/video/video.worker';
import { startScheduledTasksRunner } from './modules/admin/scheduled-tasks.runner';
import { ensureMarketV2Tables } from './storage/sqlite/ensure-market-schema';
import { ensureRelationalSchema } from './storage/sqlite/ensure-relational-schema';

// DNS/MinIO 瞬时失败不应拖垮整进程（Vultr 1GB VPS 上同步负载高时偶发 EAI_AGAIN）
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled rejection: ${reason instanceof Error ? reason.message : String(reason)}`);
});
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err instanceof Error ? err.message : String(err)}`);
});

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
      await ensureRelationalSchema();
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

