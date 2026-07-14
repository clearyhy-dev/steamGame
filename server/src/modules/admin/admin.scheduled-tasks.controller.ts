import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import type { ScheduledTaskKey, ScheduledTaskStored } from './scheduled-tasks.repository';
import { ScheduledTasksRepository } from './scheduled-tasks.repository';
import {
  buildCronExpression,
  isTaskRunningInProcess,
  runAllEnabledScheduledTasks,
  runScheduledTaskById,
  stopAllCronJobs,
} from './scheduled-tasks.runner';
import cron from 'node-cron';

const TASK_KEYS = new Set<ScheduledTaskKey>([
  'steam_catalog_sync',
  'market_country_round_robin',
  'market_daily_all_countries',
  'market_build_lists',
  'cleanup_invalid_deal_links',
  'build_public_cache',
  'request_log_cleanup',
]);

function serializeTask(t: ScheduledTaskStored): Record<string, unknown> {
  return {
    ...t,
    lastRunAt: t.lastRunAt ? t.lastRunAt.toDate().toISOString() : null,
    lastRunOk: typeof t.lastRunOk === 'boolean' ? t.lastRunOk : null,
    lastRunSummary: t.lastRunSummary ?? null,
  };
}

export class AdminScheduledTasksController {
  private repo = new ScheduledTasksRepository();

  constructor(private env: Env) {}

  list = async (_req: Request, res: Response): Promise<void> => {
    const doc = await this.repo.get();
    sendAdminOk(res, {
      tasks: doc.tasks.map(serializeTask),
      updatedAt: doc.updatedAt.toDate().toISOString(),
      createdAt: doc.createdAt.toDate().toISOString(),
      discountOffersPersistence: this.env.discountOffersPersistence,
    });
  };

  save = async (req: Request, res: Response): Promise<void> => {
    const raw = req.body?.tasks;
    if (!Array.isArray(raw)) {
      sendAdminFail(res, 400, 'tasks array required');
      return;
    }
    if (raw.length === 0) {
      sendAdminFail(res, 400, 'tasks 不能为空');
      return;
    }
    const tasks: ScheduledTaskStored[] = [];
    for (const row of raw) {
      const id = String(row?.id ?? '').trim();
      const taskKey = String(row?.taskKey ?? '').trim() as ScheduledTaskKey;
      if (!id || !TASK_KEYS.has(taskKey)) {
        sendAdminFail(res, 400, `invalid task: id=${id} taskKey=${taskKey}`);
        return;
      }
      const frequency = String(row?.frequency ?? 'daily').trim() as ScheduledTaskStored['frequency'];
      if (frequency !== 'daily' && frequency !== 'hourly' && frequency !== 'every_n_hours') {
        sendAdminFail(res, 400, 'frequency must be daily | hourly | every_n_hours');
        return;
      }
      const t: ScheduledTaskStored = {
        id,
        label: String(row?.label ?? id).trim() || id,
        enabled: Boolean(row?.enabled),
        taskKey,
        timezone: String(row?.timezone ?? 'America/New_York').trim() || 'America/New_York',
        frequency,
        timeOfDay: row?.timeOfDay != null ? String(row.timeOfDay).trim() : undefined,
        everyHours: row?.everyHours != null ? Math.max(1, Math.min(23, Math.trunc(Number(row.everyHours)))) : undefined,
        payload: typeof row?.payload === 'object' && row.payload !== null ? (row.payload as Record<string, unknown>) : {},
      };
      const expr = buildCronExpression(t);
      if (!expr || !cron.validate(expr)) {
        sendAdminFail(res, 400, `无法解析 cron：任务 ${id}（检查 frequency / timeOfDay / everyHours）`);
        return;
      }
      tasks.push(t);
    }
    const doc = await this.repo.saveTasks(tasks);
    sendAdminOk(res, {
      tasks: doc.tasks.map(serializeTask),
      updatedAt: doc.updatedAt.toDate().toISOString(),
      createdAt: doc.createdAt.toDate().toISOString(),
      discountOffersPersistence: this.env.discountOffersPersistence,
    });
  };

  /** 紧急停止：停 cron、Firestore 全部任务设为禁用、清除「执行中」状态 */
  emergencyStop = async (_req: Request, res: Response): Promise<void> => {
    stopAllCronJobs();
    const doc = await this.repo.disableAllTasksAndClearRunning();
    sendAdminOk(res, {
      stopped: true,
      tasks: doc.tasks.map(serializeTask),
      updatedAt: doc.updatedAt.toDate().toISOString(),
      message: '已停止全部计划任务 cron；任务已禁用；执行中标记已清除。新实例需 BACKGROUND_WORKERS_ENABLED=false。',
    });
  };

  /** 依次执行全部已启用任务，刷新每条 lastRun* 状态 */
  runAllEnabled = async (req: Request, res: Response): Promise<void> => {
    if (!this.env.backgroundWorkersEnabled) {
      sendAdminFail(res, 503, '后台任务已全局暂停（BACKGROUND_WORKERS_ENABLED=false）');
      return;
    }
    const sync =
      String(req.query.sync ?? '').trim() === '1' ||
      req.body?.sync === true ||
      req.body?.sync === 'true';
    if (!sync) {
      void runAllEnabledScheduledTasks(this.env).catch(() => undefined);
      sendAdminOk(res, {
        async: true,
        message: '已在后台依次执行全部已启用任务，请稍后刷新本页查看状态',
      });
      return;
    }
    const results = await runAllEnabledScheduledTasks(this.env);
    const doc = await this.repo.get();
    sendAdminOk(res, {
      async: false,
      results,
      tasks: doc.tasks.map(serializeTask),
      updatedAt: doc.updatedAt.toDate().toISOString(),
    });
  };

  /** 立即执行单条计划任务；默认异步（避免长任务断开 HTTP），`?sync=1` 或 body.sync 为 true 时同步等待 */
  runNow = async (req: Request, res: Response): Promise<void> => {
    if (!this.env.backgroundWorkersEnabled) {
      sendAdminFail(res, 503, '后台任务已全局暂停（BACKGROUND_WORKERS_ENABLED=false），不会执行折扣/同步。');
      return;
    }
    const taskId = String(req.params.taskId ?? '').trim();
    if (!taskId) {
      sendAdminFail(res, 400, 'taskId required');
      return;
    }
    const sync =
      String(req.query.sync ?? '').trim() === '1' ||
      req.body?.sync === true ||
      req.body?.sync === 'true';
    try {
      if (!sync) {
        const repo = new ScheduledTasksRepository();
        const doc = await repo.get();
        const task = doc.tasks.find((t) => t.id === taskId);
        if (!task) {
          sendAdminFail(res, 404, `scheduled task not found: ${taskId}`);
          return;
        }
        const sum = String(task.lastRunSummary ?? '');
        if (sum.includes('执行中') || isTaskRunningInProcess(taskId)) {
          sendAdminFail(res, 409, '该任务仍在执行中，请稍后再试（勿重复点击）。长任务请用 ?sync=1 或减小 topN / maxCountries。');
          return;
        }
        await repo.recordLastRun(taskId, {
          summary: '执行中…（后台运行，请稍后刷新本页查看结果）',
          error: null,
        });
        void runScheduledTaskById(this.env, taskId).catch((e) => {
          const msg = e instanceof Error ? e.message : String(e);
          void repo.recordLastRun(taskId, { ok: false, error: msg, summary: null });
        });
        const fresh = await repo.get();
        const updated = fresh.tasks.find((t) => t.id === taskId);
        sendAdminOk(res, {
          task: updated ? serializeTask(updated) : serializeTask(task),
          async: true,
        });
        return;
      }
      const updated = await runScheduledTaskById(this.env, taskId);
      sendAdminOk(res, { task: serializeTask(updated), async: false });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      sendAdminFail(res, 400, msg);
    }
  };
}
