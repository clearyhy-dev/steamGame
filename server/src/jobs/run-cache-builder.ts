/**
 * Cloud Run Job / 本地定时：node dist/jobs/run-cache-builder.js
 * 依赖：FIREBASE_PROJECT_ID、GOOGLE_APPLICATION_CREDENTIALS、GCS_CACHE_BUCKET 或 VIDEO_GCS_BUCKET
 */
import { loadEnv } from '../config/env';
import { runCacheBuild } from './cacheBuilder';
import { logger } from '../utils/logger';

async function main() {
  const env = loadEnv();
  const out = await runCacheBuild(env);
  logger.info(`[run-cache-builder] success ${JSON.stringify(out)}`);
}

main().catch((e) => {
  logger.error(`[run-cache-builder] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
