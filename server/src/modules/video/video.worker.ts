import admin from 'firebase-admin';
import type { Env } from '../../config/env';
import { getEffectiveEnv } from '../../config/runtime-config';
import { logger } from '../../utils/logger';
import { VideoJobRepository } from './video-job.repository';
import { VideoAdminService } from './video-admin.service';

let busy = false;

export function startVideoWorker(baseEnv: Env): void {
  void (async () => {
    const env = await getEffectiveEnv(baseEnv);
    const interval = env.videoWorkerIntervalMs;
    logger.info(`Video worker started (interval=${interval}ms)`);

    setInterval(() => {
      void tick(baseEnv);
    }, interval);
  })();
}

async function tick(baseEnv: Env): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const env = await getEffectiveEnv(baseEnv);
    const jobsRepo = new VideoJobRepository();
    const pending = await jobsRepo.findPendingJobs(5);
    if (pending.length === 0) return;

    const adminService = new VideoAdminService(env);
    for (const job of pending) {
      await jobsRepo.update(job.jobId, {
        status: 'running',
        startedAt: admin.firestore.Timestamp.now(),
      });

      try {
        await adminService.executeJob(job.jobId);
      } catch (e) {
        logger.warn(`Job ${job.jobId} failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    busy = false;
  }
}
