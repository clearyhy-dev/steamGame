import type { Env } from '../../config/env';
import { getEffectiveEnv } from '../../config/runtime-config';
import { logger } from '../../utils/logger';
import { RequestLogRepository } from './request-log.repository';

const repo = new RequestLogRepository();
let busy = false;

export function startRequestLogCleanupWorker(baseEnv: Env): void {
  void (async () => {
    const intervalMs = 6 * 60 * 60 * 1000;
    logger.info(`[request-log.cleanup] worker started interval=${intervalMs}ms`);
    setInterval(() => {
      void tick(baseEnv);
    }, intervalMs);
    void tick(baseEnv);
  })();
}

async function tick(baseEnv: Env): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const env = await getEffectiveEnv(baseEnv);
    const raw = Number(env.requestLogRetentionDays);
    const retentionDays = Number.isFinite(raw) ? Math.max(1, Math.min(30, Math.round(raw))) : 14;
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const deleted = await repo.cleanupOlderThan(cutoff, 300);
    if (deleted > 0) {
      logger.info(`[request-log.cleanup] retentionDays=${retentionDays} deleted=${deleted}`);
    } else {
      logger.info(`[request-log.cleanup] retentionDays=${retentionDays} deleted=0`);
    }
  } catch (e) {
    logger.warn(`[request-log.cleanup] failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    busy = false;
  }
}
