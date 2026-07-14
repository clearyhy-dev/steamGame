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
  runMarketDailyFullSync,
  runMarketCountryRoundRobinShard,
} from '../market/market-round-robin.runner';
import { runMarketStaleDiscountCleanup } from '../market/market-stale-cleanup.service';
import type { MarketRoundRobinPayload } from '../market/market.types';
import { AdminSettingsRepository } from './admin.settings.repository';
import { resolveDiscountCfgForPriceSync } from '../market/market-discount-config.util';
import { WishlistPriceAlertService } from '../notify/wishlist-price-alert.service';

const MARKET_TASK_KEYS = new Set<ScheduledTaskStored['taskKey']>([
  'market_country_round_robin',
  'market_country_round_robin_shard',
  'market_daily_all_countries',
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

async function assertMarketDiscountKeysForPriceSync(payload: Record<string, unknown> | undefined): Promise<void> {
  if (payload?.includePrices === false) return;
  await resolveDiscountCfgForPriceSync(undefined, new AdminSettingsRepository());
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
        await assertMarketDiscountKeysForPriceSync(p);
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
          batchesPerRun: p.batchesPerRun != null ? Number(p.batchesPerRun) : undefined,
        };
        const batchesPerRun = Math.max(1, Math.min(Number(payload.batchesPerRun ?? 1), 20));
        let lastR: Awaited<ReturnType<typeof runMarketCountryRoundRobin>> | null = null;
        const parts: string[] = [];
        for (let bi = 0; bi < batchesPerRun; bi++) {
          const r = await runMarketCountryRoundRobin(env, payload);
          lastR = r;
          parts.push(r.summary);
          logger.info(`[scheduled-tasks] ${task.taskKey} batch ${bi + 1}/${batchesPerRun} ${r.summary}`);
          if (r.failed > 0 && r.success === 0 && r.skipped === 0 && r.processed > 0) break;
          if (r.countryCompleted) break;
        }
        summary = parts.join(' | ');
        ok = !!lastR && (lastR.processed === 0 ? lastR.skipped > 0 : lastR.success > 0 || lastR.skipped > 0);
        if (lastR && !ok && lastR.failed > 0) error = `本批失败 ${lastR.failed}/${lastR.processed}`;
        break;
      }
      case 'market_country_round_robin_shard': {
        await assertMarketDiscountKeysForPriceSync(p);
        const workerId = Number(p.workerId ?? 0);
        const payload: MarketRoundRobinPayload & { workerId: number; workerCount?: number; resetShard?: boolean } = {
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
          batchesPerRun: p.batchesPerRun != null ? Number(p.batchesPerRun) : undefined,
          workerId,
          workerCount: p.workerCount != null ? Number(p.workerCount) : undefined,
          resetShard: p.resetShard === true,
        };
        const batchesPerRun = Math.max(1, Math.min(Number(payload.batchesPerRun ?? 1), 20));
        let lastR: Awaited<ReturnType<typeof runMarketCountryRoundRobinShard>> | null = null;
        const parts: string[] = [];
        let resetShard = payload.resetShard === true;
        for (let bi = 0; bi < batchesPerRun; bi++) {
          const r = await runMarketCountryRoundRobinShard(env, { ...payload, resetShard });
          resetShard = false;
          lastR = r;
          parts.push(r.summary);
          logger.info(`[scheduled-tasks] ${task.taskKey} W${workerId} batch ${bi + 1}/${batchesPerRun} ${r.summary}`);
          if (r.failed > 0 && r.success === 0 && r.skipped === 0 && r.processed > 0) break;
          if (r.countryCompleted) break;
        }
        summary = parts.join(' | ');
        ok = !!lastR && (lastR.processed === 0 ? lastR.skipped > 0 : lastR.success > 0 || lastR.skipped > 0);
        if (lastR && !ok && lastR.failed > 0) error = `Worker ${workerId} 本批失败 ${lastR.failed}/${lastR.processed}`;
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
      case 'market_daily_all_countries': {
        await assertMarketDiscountKeysForPriceSync(p);
        const tierRaw = String(p.syncTierFilter ?? '').trim().toUpperCase();
        const syncTierFilter = tierRaw === 'T1' || tierRaw === 'T2' ? (tierRaw as 'T1' | 'T2') : undefined;
        const payload: MarketRoundRobinPayload = {
          batchSize: p.batchSize != null ? Number(p.batchSize) : undefined,
          topNPerCountry: p.topNPerCountry != null ? Number(p.topNPerCountry) : undefined,
          delayMs: p.delayMs != null ? Number(p.delayMs) : undefined,
          concurrency: p.concurrency != null ? Number(p.concurrency) : undefined,
          platforms: Array.isArray(p.platforms) ? (p.platforms as string[]) : undefined,
          cleanupBeforeSync: p.cleanupBeforeSync !== false,
          cleanupMaxRows: p.cleanupMaxRows != null ? Number(p.cleanupMaxRows) : undefined,
          cleanupMaxBatches: p.cleanupMaxBatches != null ? Number(p.cleanupMaxBatches) : undefined,
          cleanupStaleOlderThanHours:
            p.cleanupStaleOlderThanHours != null ? Number(p.cleanupStaleOlderThanHours) : undefined,
          syncTierFilter,
        };
        const r = await runMarketDailyFullSync(env, payload);
        summary = syncTierFilter ? `[${syncTierFilter}] ${r.summary}` : r.summary;
        const skippedTierDay = r.countries === 0 && /已跳过/.test(r.summary);
        ok =
          skippedTierDay ||
          (r.totalProcessed > 0 &&
            (r.countriesCompleted >= Math.max(1, Math.floor(r.countries * 0.9)) || r.totalSuccess > 0));
        if (r.countries > 0 && r.totalProcessed === 0 && !skippedTierDay) {
          ok = false;
          error = '无游戏被处理（Steam 畅销榜为空或未拉取到 appid）';
        } else if (!ok && r.totalFailed > 0) {
          error = `失败 ${r.totalFailed}/${r.totalProcessed}`;
        }
        logger.info(`[scheduled-tasks] ${task.taskKey} ${summary}`);
        break;
      }
      case 'cleanup_invalid_deal_links': {
        const intervalDays = Math.max(1, Math.min(Number(p.cleanupIntervalDays ?? 3), 30));
        const tz = String(process.env.DEAL_SYNC_PRICE_DAY_TZ ?? 'Asia/Shanghai').trim() || 'Asia/Shanghai';
        const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
        const dayKey = fmt.format(new Date());
        const dayNum = Math.floor(new Date(`${dayKey}T12:00:00Z`).getTime() / 86400000);
        if (dayNum % intervalDays !== 0) {
          summary = `跳过（每 ${intervalDays} 天清理一次，今日不执行）`;
          ok = true;
          break;
        }
        const legacy = await dealBatch.runInvalidDealLinksCleanup(Number(p.maxDelete ?? 5000));
        let marketPart = '';
        if (env.discountOffersPersistence === 'object_storage') {
          const m = await runMarketStaleDiscountCleanup(env, {
            maxRows: Number(p.maxMarketRows ?? 5000),
            staleOlderThanHours: Number(p.staleOlderThanHours ?? 72),
          });
          marketPart = ` · market 清索引 ${m.clearedIndex} 对象 ${m.clearedObjects}`;
        }
        summary = `legacy invalid 文档 ${legacy.deleted}${marketPart}`;
        ok = true;
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
      case 'wishlist_price_email_alert': {
        const svc = new WishlistPriceAlertService(env);
        const out = await svc.runProAlerts();
        summary = `愿望单邮件 users=${out.usersScanned} sent=${out.emailsSent} skipped=${out.alertsSkipped} errors=${out.errors}`;
        ok = out.errors === 0;
        if (!ok) error = `${out.errors} user batch errors`;
        logger.info(`[scheduled-tasks] wishlist_price_email_alert ${summary}`);
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
