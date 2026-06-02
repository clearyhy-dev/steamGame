import cron from 'node-cron';
import type { Env } from '../../config/env';
import { logger } from '../../utils/logger';
import { runCacheBuild } from '../../jobs/cacheBuilder';
import { DealSyncBatchService } from '../game/deal-sync-batch.service';
import { runSteamCatalogSyncTick } from '../steam/steam-sync.worker';
import { runRequestLogCleanupTick } from '../observability/request-log-cleanup.worker';
import type { ScheduledTaskStored } from './scheduled-tasks.repository';
import {
  SCHEDULED_TASK_RUN_ORDER,
  ScheduledTasksRepository,
} from './scheduled-tasks.repository';
import {
  runMarketCountryRoundRobin,
  runMarketBuildAllLists,
} from '../market/market-round-robin.runner';
import type { MarketRoundRobinPayload } from '../market/market.types';

const MARKET_TASK_KEYS = new Set<ScheduledTaskStored['taskKey']>([
  'market_country_round_robin',
  'market_build_lists',
]);

function assertMarketStorage(env: Env, taskKey: ScheduledTaskStored['taskKey']): void {
  if (!MARKET_TASK_KEYS.has(taskKey)) return;
  if (env.discountOffersPersistence !== 'object_storage') {
    throw new Error(
      '分国市场任务要求 DISCOUNT_OFFERS_PERSISTENCE=object_storage（价格写入对象存储）。请配置 S3_* 或 GCS_CACHE_BUCKET 后重试。',
    );
  }
}

const jobs: cron.ScheduledTask[] = [];
const runningTaskIds = new Set<string>();

const STALE_RUNNING_MS = 45 * 60 * 1000;

export function stopAllCronJobs(): void {
  for (const j of jobs) {
    try {
      j.stop();
    } catch {
      /* ignore */
    }
  }
  jobs.length = 0;
}

export function buildCronExpression(task: ScheduledTaskStored): string | null {
  if (task.frequency === 'hourly') {
    return '0 * * * *';
  }
  if (task.frequency === 'every_n_hours') {
    const n = Math.max(1, Math.min(23, Number(task.everyHours ?? 6)));
    return `0 */${n} * * *`;
  }
  if (task.frequency === 'daily') {
    const raw = String(task.timeOfDay ?? '03:00').trim();
    const [hPart, mPart] = raw.split(':');
    const H = Math.max(0, Math.min(23, Math.trunc(Number(hPart) || 3)));
    const M = Math.max(0, Math.min(59, Math.trunc(Number(mPart) || 0)));
    return `${M} ${H} * * *`;
  }
  return null;
}

export function isTaskRunningInProcess(taskId: string): boolean {
  return runningTaskIds.has(taskId);
}

export async function runScheduledTask(env: Env, task: ScheduledTaskStored, repo: ScheduledTasksRepository): Promise<void> {
  if (runningTaskIds.has(task.id)) {
    logger.warn(`[scheduled-tasks] skip duplicate run id=${task.id} (already in process)`);
    return;
  }
  runningTaskIds.add(task.id);
  const dealBatch = new DealSyncBatchService(env);
  let summary = '';
  let ok = true;
  let error: string | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    logger.info(`[scheduled-tasks] run start id=${task.id} key=${task.taskKey}`);
    if (MARKET_TASK_KEYS.has(task.taskKey)) {
      heartbeat = setInterval(() => {
        void repo.recordLastRun(task.id, {
          summary: `执行中…（${new Date().toISOString()}，请勿重复点「立即运行」）`,
          error: null,
        });
      }, 120_000);
    }
    assertMarketStorage(env, task.taskKey);
    const p = task.payload ?? {};
    switch (task.taskKey) {
      case 'market_country_round_robin': {
        const payload: MarketRoundRobinPayload = {
          batchSize: p.batchSize != null ? Number(p.batchSize) : undefined,
          topNPerCountry: p.topNPerCountry != null ? Number(p.topNPerCountry) : undefined,
          delayMs: p.delayMs != null ? Number(p.delayMs) : undefined,
          skipSyncedToday: p.skipSyncedToday !== false,
          forceRefresh: p.forceRefresh === true,
          includeDetail: p.includeDetail === true,
          includeHeat: p.includeHeat === true,
          includePrices: p.includePrices !== false,
          concurrency: p.concurrency != null ? Number(p.concurrency) : undefined,
          platforms: Array.isArray(p.platforms) ? (p.platforms as string[]) : undefined,
        };
        const r = await runMarketCountryRoundRobin(env, payload);
        summary = r.summary;
        ok = r.processed === 0 ? false : r.success > 0 || r.skipped > 0;
        if (!ok && r.failed > 0) error = `本批失败 ${r.failed}/${r.processed}`;
        logger.info(`[scheduled-tasks] ${task.taskKey} ${summary}`);
        break;
      }
      case 'market_build_lists': {
        const r = await runMarketBuildAllLists(env);
        summary = `分国榜单 国家数=${r.countries} 文件数=${r.keys.length}`;
        ok = r.keys.length > 0;
        if (!ok) error = '未生成任何榜单文件';
        logger.info(`[scheduled-tasks] market_build_lists ${summary}`);
        break;
      }
      case 'cleanup_invalid_deal_links': {
        const r = await dealBatch.runInvalidDealLinksCleanup(Number(p.maxDelete ?? 5000));
        summary = `已清理含 invalid 的折扣文档 ${r.deleted} 个（上限 payload.maxDelete，单文档可删多源字段）`;
        logger.info(`[scheduled-tasks] cleanup_invalid_deal_links ${summary}`);
        break;
      }
      case 'steam_catalog_sync': {
        const out = await runSteamCatalogSyncTick(env, { bypassEnabledGate: true });
        summary = out.summary;
        ok = out.ok;
        error = out.error;
        logger.info(`[scheduled-tasks] steam_catalog_sync ok=${ok} ${summary}`);
        break;
      }
      case 'request_log_cleanup': {
        const out = await runRequestLogCleanupTick(env);
        summary = out.skipped ? '上一轮仍在执行，已跳过' : `已删除请求日志 ${out.deleted} 条`;
        logger.info(`[scheduled-tasks] request_log_cleanup ${summary}`);
        break;
      }
      case 'build_public_cache': {
        const out = await runCacheBuild(env);
        summary = `缓存快照 backend=${out.backend} 文件数=${out.keys.length} ${out.keys.join(' ')}`;
        ok = out.keys.length > 0;
        logger.info(`[scheduled-tasks] build_public_cache ${summary}`);
        break;
      }
      default:
        logger.warn(`[scheduled-tasks] unknown taskKey=${task.taskKey}`);
        summary = `未知任务类型 ${task.taskKey}`;
        ok = false;
        error = '未识别的 taskKey';
    }
    await repo.recordLastRun(task.id, {
      ok,
      summary: summary || null,
      error: ok ? null : (error ?? (summary ? '任务未达成功条件，见摘要' : null)),
    });
    logger.info(`[scheduled-tasks] run ok id=${task.id} lastRunOk=${ok}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`[scheduled-tasks] run failed id=${task.id} err=${msg}`);
    await repo.recordLastRun(task.id, { ok: false, error: msg, summary: null });
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    runningTaskIds.delete(task.id);
  }
}

export type ScheduledTaskRunResult = {
  id: string;
  taskKey: string;
  ok: boolean;
  summary?: string;
  error?: string;
  skipped?: boolean;
};

/** 按顺序执行已启用计划任务并写回 lastRun*（状态每日刷新） */
export async function runAllEnabledScheduledTasks(
  env: Env,
  opts?: { taskIds?: string[] },
): Promise<ScheduledTaskRunResult[]> {
  const repo = new ScheduledTasksRepository();
  const doc = await repo.get();
  const order = opts?.taskIds?.length ? opts.taskIds : SCHEDULED_TASK_RUN_ORDER;
  const byId = new Map(doc.tasks.filter((t) => t.enabled).map((t) => [t.id, t]));
  const out: ScheduledTaskRunResult[] = [];
  const seen = new Set<string>();
  for (const id of order) {
    const task = byId.get(id);
    if (!task || seen.has(task.id)) continue;
    seen.add(task.id);
    if (runningTaskIds.has(task.id)) {
      out.push({
        id: task.id,
        taskKey: task.taskKey,
        ok: false,
        skipped: true,
        error: '任务仍在执行中，已跳过',
      });
      continue;
    }
    await runScheduledTask(env, task, repo);
    const fresh = (await repo.get()).tasks.find((t) => t.id === task.id);
    out.push({
      id: task.id,
      taskKey: task.taskKey,
      ok: fresh?.lastRunOk === true,
      summary: fresh?.lastRunSummary,
      error: fresh?.lastError,
    });
  }
  for (const task of doc.tasks) {
    if (!task.enabled || seen.has(task.id)) continue;
    if (runningTaskIds.has(task.id)) continue;
    await runScheduledTask(env, task, repo);
    const fresh = (await repo.get()).tasks.find((t) => t.id === task.id);
    out.push({
      id: task.id,
      taskKey: task.taskKey,
      ok: fresh?.lastRunOk === true,
      summary: fresh?.lastRunSummary,
      error: fresh?.lastError,
    });
  }
  return out;
}

/** @deprecated 请用 runAllEnabledScheduledTasks；保留给旧 Cron 路径 */
export async function runAllEnabledDealScheduledTasks(env: Env): Promise<ScheduledTaskRunResult[]> {
  const marketOrder = SCHEDULED_TASK_RUN_ORDER.filter((id) => id.startsWith('market_'));
  return runAllEnabledScheduledTasks(env, { taskIds: marketOrder });
}

/** 管理端「立即运行」：按任务 id 执行并写回 lastRun* */
export async function runScheduledTaskById(env: Env, taskId: string): Promise<ScheduledTaskStored> {
  const repo = new ScheduledTasksRepository();
  const doc = await repo.get();
  const task = doc.tasks.find((t) => t.id === taskId);
  if (!task) {
    throw new Error(`scheduled task not found: ${taskId}`);
  }
  await runScheduledTask(env, task, repo);
  const fresh = await repo.get();
  const updated = fresh.tasks.find((t) => t.id === taskId);
  if (!updated) {
    throw new Error(`scheduled task missing after run: ${taskId}`);
  }
  return updated;
}

function registerJobsForTasks(env: Env, list: ScheduledTaskStored[], repo: ScheduledTasksRepository): void {
  for (const task of list) {
    if (!task.enabled) continue;
    const expr = buildCronExpression(task);
    if (!expr || !cron.validate(expr)) {
      logger.warn(`[scheduled-tasks] skip invalid schedule task=${task.id} expr=${expr}`);
      continue;
    }
    const tz = String(task.timezone || 'America/New_York').trim() || 'America/New_York';
    try {
      const job = cron.schedule(
        expr,
        () => {
          void runScheduledTask(env, task, repo);
        },
        { timezone: tz },
      );
      jobs.push(job);
      logger.info(`[scheduled-tasks] registered id=${task.id} cron=${expr} tz=${tz}`);
    } catch (e) {
      logger.warn(`[scheduled-tasks] register failed id=${task.id} err=${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

export function startScheduledTasksRunner(env: Env): void {
  if (!env.backgroundWorkersEnabled) {
    stopAllCronJobs();
    logger.warn('[scheduled-tasks] runner not started (BACKGROUND_WORKERS_ENABLED=false)');
    return;
  }
  const repo = new ScheduledTasksRepository();
  const refresh = async () => {
    try {
      const cleared = await repo.clearStaleRunningTasks(STALE_RUNNING_MS);
      if (cleared > 0) {
        logger.warn(`[scheduled-tasks] cleared ${cleared} stale "执行中" task(s)`);
      }
      const doc = await repo.get();
      stopAllCronJobs();
      registerJobsForTasks(env, doc.tasks, repo);
    } catch (e) {
      logger.error(`[scheduled-tasks] refresh failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  void refresh();
  setInterval(() => {
    void refresh();
  }, 90_000);
}
