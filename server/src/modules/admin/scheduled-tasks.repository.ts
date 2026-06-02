import admin from 'firebase-admin';
import { getFirestore } from '../../config/firebase';
import { useSqliteRelationalStore } from '../../config/database';

const COLLECTION = 'system_config';
const DOC_ID = 'scheduled_tasks';

/** 已废弃的全渠道任务：读配置时剔除并写回，仅保留四条分平台 Top 任务。 */
function stripLegacyDailyDealsTop1000(tasks: ScheduledTaskStored[]): { tasks: ScheduledTaskStored[]; changed: boolean } {
  const next = tasks.filter(
    (t) => t.id !== 'daily_deals_top1000' && String(t.taskKey) !== 'daily_deals_top1000',
  );
  return { tasks: next, changed: next.length !== tasks.length };
}

/** Firestore 不接受 undefined；管理端保存的任务对象常带 timeOfDay/everyHours 等互斥字段为 undefined，会导致 set 失败。 */
function sanitizePayloadDeep(p: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizePayloadDeep(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function sanitizeScheduledTaskForFirestore(t: ScheduledTaskStored): ScheduledTaskStored {
  const freq = t.frequency;
  const out: Record<string, unknown> = {
    id: t.id,
    label: t.label,
    enabled: t.enabled,
    taskKey: t.taskKey,
    timezone: t.timezone,
    frequency: freq,
    payload: sanitizePayloadDeep((t.payload ?? {}) as Record<string, unknown>),
  };
  if (freq === 'daily') {
    out.timeOfDay = String(t.timeOfDay ?? '03:00').trim() || '03:00';
  } else if (freq === 'every_n_hours') {
    out.everyHours = Math.max(1, Math.min(23, Number(t.everyHours ?? 6)));
  }
  if (t.lastRunAt !== undefined) out.lastRunAt = t.lastRunAt;
  if (typeof t.lastRunOk === 'boolean') out.lastRunOk = t.lastRunOk;
  if (typeof t.lastRunSummary === 'string' && t.lastRunSummary.trim() !== '') {
    out.lastRunSummary = t.lastRunSummary.trim();
  }
  if (typeof t.lastError === 'string' && t.lastError.trim() !== '') {
    out.lastError = t.lastError.trim();
  }
  return out as ScheduledTaskStored;
}

export type ScheduledTaskKey =
  | 'steam_catalog_sync'
  | 'market_country_round_robin'
  | 'market_build_lists'
  | 'cleanup_invalid_deal_links'
  | 'build_public_cache'
  | 'request_log_cleanup';

export type ScheduledTaskStored = {
  id: string;
  label: string;
  enabled: boolean;
  taskKey: ScheduledTaskKey;
  /** IANA；界面默认「美国东部」America/New_York */
  timezone: string;
  frequency: 'daily' | 'hourly' | 'every_n_hours';
  /** `HH:mm`（24h），仅 daily */
  timeOfDay?: string;
  /** 1–23，仅 every_n_hours */
  everyHours?: number;
  payload?: Record<string, unknown>;
  lastRunAt?: admin.firestore.Timestamp;
  /** 最近一次执行是否视为成功（部分业务规则下「有失败行」也会记为 false） */
  lastRunOk?: boolean;
  /** 人类可读摘要：删除条数、批处理统计等 */
  lastRunSummary?: string;
  lastError?: string;
};

export type ScheduledTasksDocument = {
  tasks: ScheduledTaskStored[];
  updatedAt: admin.firestore.Timestamp;
  createdAt: admin.firestore.Timestamp;
};

const DEFAULT_TASKS = (): ScheduledTaskStored[] => defaultTasksInner();

function isCorruptTaskLabel(label: string, expected?: string): boolean {
  const s = String(label ?? '').trim();
  if (!s) return true;
  if (/\?{2,}/.test(s) && !/[\u4e00-\u9fff]/.test(s)) return true;
  if (expected && /[\u4e00-\u9fff]/.test(expected) && !/[\u4e00-\u9fff]/.test(s)) return true;
  return false;
}

function applyDefaultLabels(tasks: ScheduledTaskStored[]): ScheduledTaskStored[] {
  const byId = new Map(DEFAULT_TASKS().map((t) => [t.id, t.label]));
  return tasks.map((t) => {
    const defLabel = byId.get(t.id);
    if (!defLabel) return t;
    if (isCorruptTaskLabel(t.label, defLabel)) return { ...t, label: defLabel };
    return t;
  });
}

function labelsChanged(before: ScheduledTaskStored[], after: ScheduledTaskStored[]): boolean {
  return before.some((t, i) => t.label !== after[i]?.label);
}

function defaultTasks(): ScheduledTaskStored[] {
  return defaultTasksInner();
}

/** 计划任务默认 IANA 时区（与 DEAL_SYNC_PRICE_DAY_TZ 默认一致） */
export const SCHEDULED_TASK_TIMEZONE = 'Asia/Shanghai';

/** 每日依次执行顺序（按任务 id；Cloud Scheduler / 管理端「运行全部」） */
export const SCHEDULED_TASK_RUN_ORDER: string[] = [
  'steam_catalog_sync',
  'market_rr_02',
  'market_rr_10',
  'market_rr_18',
  'market_build_lists',
  'request_log_cleanup',
  'cleanup_invalid_deal_links',
];

const LEGACY_V1_DEAL_TASK_IDS = new Set([
  'daily_deals_top_steam',
  'daily_deals_top_itad',
  'daily_deals_top_ggdeals',
  'daily_deals_top_cheapshark',
  'daily_deals_catalog_batch',
  'daily_deals_per_platform_heat',
  'daily_deals_per_platform_heat_steam',
  'daily_deals_per_platform_heat_itad',
  'daily_deals_per_platform_heat_ggdeals',
  'daily_deals_per_platform_heat_cheapshark',
  'daily_deals_top1000',
  'steam_top500_heat_pipeline',
]);

const MARKET_ROUND_ROBIN_PAYLOAD = {
  topNPerCountry: 200,
  batchSize: 50,
  delayMs: 30,
  skipSyncedToday: true,
  forceRefresh: false,
  includeDetail: false,
  includeHeat: false,
  includePrices: true,
  concurrency: 6,
};

function enforceMarketRoundRobinPayload(tasks: ScheduledTaskStored[]): { tasks: ScheduledTaskStored[]; changed: boolean } {
  let changed = false;
  const next = tasks.map((t) => {
    if (t.taskKey !== 'market_country_round_robin') return t;
    const merged = { ...(t.payload ?? {}), ...MARKET_ROUND_ROBIN_PAYLOAD };
    const wantLabel = `分国市场轮询 · ${t.timeOfDay ?? '—'}（Top200/国，四平台价，并发${merged.concurrency ?? 6}）`;
    const payloadChanged = JSON.stringify(t.payload ?? {}) !== JSON.stringify(merged);
    const labelChanged = t.label !== wantLabel;
    if (!payloadChanged && !labelChanged) return t;
    changed = true;
    return { ...t, label: wantLabel, payload: merged };
  });
  return { tasks: next, changed };
}

function stripLegacyV1DealTasks(tasks: ScheduledTaskStored[]): { tasks: ScheduledTaskStored[]; changed: boolean } {
  const next = tasks.filter((t) => !LEGACY_V1_DEAL_TASK_IDS.has(t.id));
  return { tasks: next, changed: next.length !== tasks.length };
}

/** 确保所有默认定时任务为每日启用（升级旧配置：hourly / 禁用 / 非上海时区） */
function enforceAllTasksDailySchedule(tasks: ScheduledTaskStored[]): { tasks: ScheduledTaskStored[]; changed: boolean } {
  const defaults = new Map(defaultTasksInner().map((t) => [t.id, t]));
  let changed = false;
  const next = tasks.map((t) => {
    const def = defaults.get(t.id);
    if (!def) return t;
    let nt = t;
    if (!t.enabled && def.enabled) {
      nt = { ...nt, enabled: true };
      changed = true;
    }
    if (t.frequency !== 'daily') {
      nt = {
        ...nt,
        frequency: 'daily',
        timeOfDay: def.timeOfDay ?? t.timeOfDay ?? '03:00',
        everyHours: undefined,
      };
      changed = true;
    }
    const wantTz = def.timezone ?? SCHEDULED_TASK_TIMEZONE;
    if (nt.timezone !== wantTz) {
      nt = { ...nt, timezone: wantTz };
      changed = true;
    }
    if (!nt.timeOfDay && def.timeOfDay) {
      nt = { ...nt, timeOfDay: def.timeOfDay };
      changed = true;
    }
    return nt;
  });
  for (const def of defaults.values()) {
    if (!next.some((t) => t.id === def.id)) {
      next.push(def);
      changed = true;
    }
  }
  return { tasks: next, changed };
}

function defaultTasksInner(): ScheduledTaskStored[] {
  const rrPayload = { ...MARKET_ROUND_ROBIN_PAYLOAD };
  return [
    {
      id: 'steam_catalog_sync',
      label: 'Steam 应用列表 + 未同步详情补全',
      enabled: true,
      taskKey: 'steam_catalog_sync',
      timezone: SCHEDULED_TASK_TIMEZONE,
      frequency: 'daily',
      timeOfDay: '00:30',
      payload: {},
    },
    {
      id: 'market_rr_02',
      label: '分国市场轮询 · 02:00（Top200/国，四平台价，并发6）',
      enabled: true,
      taskKey: 'market_country_round_robin',
      timezone: SCHEDULED_TASK_TIMEZONE,
      frequency: 'daily',
      timeOfDay: '02:00',
      payload: { ...rrPayload },
    },
    {
      id: 'market_rr_10',
      label: '分国市场轮询 · 10:00（Top200/国，四平台价，并发6）',
      enabled: true,
      taskKey: 'market_country_round_robin',
      timezone: SCHEDULED_TASK_TIMEZONE,
      frequency: 'daily',
      timeOfDay: '10:00',
      payload: { ...rrPayload },
    },
    {
      id: 'market_rr_18',
      label: '分国市场轮询 · 18:00（Top200/国，四平台价，并发6）',
      enabled: true,
      taskKey: 'market_country_round_robin',
      timezone: SCHEDULED_TASK_TIMEZONE,
      frequency: 'daily',
      timeOfDay: '18:00',
      payload: { ...rrPayload },
    },
    {
      id: 'market_build_lists',
      label: '分国榜单 JSON（top-discounts / top-heat）',
      enabled: true,
      taskKey: 'market_build_lists',
      timezone: SCHEDULED_TASK_TIMEZONE,
      frequency: 'daily',
      timeOfDay: '20:00',
      payload: {},
    },
    {
      id: 'request_log_cleanup',
      label: '请求日志按保留天数清理',
      enabled: true,
      taskKey: 'request_log_cleanup',
      timezone: SCHEDULED_TASK_TIMEZONE,
      frequency: 'daily',
      timeOfDay: '04:30',
      payload: {},
    },
    {
      id: 'cleanup_invalid_deal_links',
      label: '清理无效折扣链接（删除 offerStatus=invalid）',
      enabled: true,
      taskKey: 'cleanup_invalid_deal_links',
      timezone: SCHEDULED_TASK_TIMEZONE,
      frequency: 'daily',
      timeOfDay: '07:00',
      payload: {},
    },
    {
      id: 'build_public_cache',
      label: '构建公开 JSON 缓存 v1（已由 market_build_lists 替代，默认关闭）',
      enabled: false,
      taskKey: 'build_public_cache',
      timezone: SCHEDULED_TASK_TIMEZONE,
      frequency: 'daily',
      timeOfDay: '08:00',
      payload: {},
    },
  ];
}

/** 合并默认任务、修正折扣 payload、强制折扣类每日启用（Firestore / SQLite 共用） */
export function migrateScheduledTasksList(tasks: ScheduledTaskStored[]): {
  tasks: ScheduledTaskStored[];
  changed: boolean;
} {
  const knownIds = new Set(tasks.map((t) => t.id));
  const merged = [...tasks];
  for (const t of defaultTasks()) {
    if (!knownIds.has(t.id)) merged.push(t);
  }
  const stripped = stripLegacyDailyDealsTop1000(merged);
  let next = stripped.tasks;
  const legacyDeal = stripLegacyV1DealTasks(next);
  next = legacyDeal.tasks;
  const relabeled = applyDefaultLabels(next);
  const labelFix = labelsChanged(next, relabeled);
  next = relabeled;
  const allDaily = enforceAllTasksDailySchedule(next);
  next = allDaily.tasks;
  const marketPayload = enforceMarketRoundRobinPayload(next);
  next = marketPayload.tasks;
  return {
    tasks: next,
    changed: stripped.changed || legacyDeal.changed || labelFix || allDaily.changed || marketPayload.changed,
  };
}

export class ScheduledTasksRepository {
  private db = getFirestore();

  async get(): Promise<ScheduledTasksDocument> {
    if (useSqliteRelationalStore()) {
      const m = await import('../../storage/sqlite/scheduled-tasks.store');
      const raw = await m.sqliteGetScheduledTasks();
      const migrated = migrateScheduledTasksList(raw.tasks);
      if (!migrated.changed) return raw;
      return m.sqliteSaveScheduledTasks(migrated.tasks);
    }
    const ref = this.db.collection(COLLECTION).doc(DOC_ID);
    const snap = await ref.get();
    const now = admin.firestore.Timestamp.now();
    if (!snap.exists) {
      const init: ScheduledTasksDocument = {
        tasks: defaultTasks(),
        createdAt: now,
        updatedAt: now,
      };
      await ref.set(init);
      return init;
    }
    const d = snap.data() as Partial<ScheduledTasksDocument>;
    const base = Array.isArray(d.tasks) && d.tasks.length > 0 ? (d.tasks as ScheduledTaskStored[]) : defaultTasks();
    const migrated = migrateScheduledTasksList(base);
    const tasks = migrated.tasks;

    if (migrated.changed) {
      const sanitized = tasks.map(sanitizeScheduledTaskForFirestore);
      await ref.set(
        {
          tasks: sanitized,
          updatedAt: now,
          legacyDailyDealsTop1000AutoDisabled: admin.firestore.FieldValue.delete(),
        },
        { merge: true },
      );
      return {
        tasks: sanitized,
        createdAt: d.createdAt ?? now,
        updatedAt: now,
      };
    }

    return {
      tasks,
      createdAt: d.createdAt ?? now,
      updatedAt: d.updatedAt ?? now,
    };
  }

  async saveTasks(tasks: ScheduledTaskStored[]): Promise<ScheduledTasksDocument> {
    if (useSqliteRelationalStore()) {
      const m = await import('../../storage/sqlite/scheduled-tasks.store');
      return m.sqliteSaveScheduledTasks(tasks);
    }
    const ref = this.db.collection(COLLECTION).doc(DOC_ID);
    const now = admin.firestore.Timestamp.now();
    const prev = await ref.get();
    const createdAt = prev.exists ? ((prev.data() as ScheduledTasksDocument).createdAt ?? now) : now;
    const prevTasks = prev.exists ? ((prev.data() as ScheduledTasksDocument).tasks ?? []) : [];
    const prevById = new Map(prevTasks.map((t) => [t.id, t]));
    const defaultById = new Map(defaultTasks().map((t) => [t.id, t]));
    const merged = applyDefaultLabels(
      tasks.map((t) => {
        const old = prevById.get(t.id);
        const def = defaultById.get(t.id);
        const base = {
          ...t,
          label: def?.label ?? t.label,
        };
        if (!old) return base;
        return {
          ...base,
          lastRunAt: old.lastRunAt,
          lastRunOk: old.lastRunOk,
          lastRunSummary: old.lastRunSummary,
          lastError: old.lastError,
        };
      }),
    );
    const sanitizedTasks = merged.map(sanitizeScheduledTaskForFirestore);
    const doc: ScheduledTasksDocument = { tasks: sanitizedTasks, createdAt, updatedAt: now };
    await ref.set(doc, { merge: true });
    return doc;
  }

  /** 启动时恢复：长时间停在「执行中」视为实例已回收 */
  async clearStaleRunningTasks(maxAgeMs: number): Promise<number> {
    if (useSqliteRelationalStore()) {
      const m = await import('../../storage/sqlite/scheduled-tasks.store');
      return m.sqliteClearStaleRunningTasks(maxAgeMs);
    }
    const doc = await this.get();
    const now = admin.firestore.Timestamp.now();
    const nowMs = now.toMillis();
    let cleared = 0;
    const tasks = doc.tasks.map((t) => {
      const sum = String(t.lastRunSummary ?? '');
      if (!sum.includes('执行中')) return t;
      const atMs = t.lastRunAt?.toMillis() ?? 0;
      if (atMs > 0 && nowMs - atMs < maxAgeMs) return t;
      cleared += 1;
      return {
        ...t,
        lastRunOk: false,
        lastRunSummary: '上次执行中断（Cloud Run 实例回收或超时），可重新「立即运行」',
        lastError: 'stale_running_cleared',
      };
    });
    if (cleared === 0) return 0;
    await this.db.collection(COLLECTION).doc(DOC_ID).set(
      { tasks: tasks.map(sanitizeScheduledTaskForFirestore), updatedAt: now },
      { merge: true },
    );
    return cleared;
  }

  /** 全部禁用并清除「执行中」摘要（紧急停费） */
  async disableAllTasksAndClearRunning(): Promise<ScheduledTasksDocument> {
    if (useSqliteRelationalStore()) {
      const m = await import('../../storage/sqlite/scheduled-tasks.store');
      return m.sqliteDisableAllTasksAndClearRunning();
    }
    const doc = await this.get();
    const now = admin.firestore.Timestamp.now();
    const tasks = doc.tasks.map((t) => {
      const next: ScheduledTaskStored = { ...t, enabled: false };
      const sum = String(t.lastRunSummary ?? '');
      if (sum.includes('执行中')) {
        next.lastRunOk = false;
        next.lastRunSummary = '已人工紧急停止（不再扣费）';
        next.lastError = undefined;
      }
      return sanitizeScheduledTaskForFirestore(next);
    });
    const out: ScheduledTasksDocument = { tasks, createdAt: doc.createdAt, updatedAt: now };
    await this.db.collection(COLLECTION).doc(DOC_ID).set(out, { merge: true });
    return out;
  }

  /** 更新任务 payload（如全库游标）；保留 lastRun* 字段 */
  async patchTaskPayload(taskId: string, patch: Record<string, unknown>): Promise<void> {
    if (useSqliteRelationalStore()) {
      const m = await import('../../storage/sqlite/scheduled-tasks.store');
      await m.sqlitePatchScheduledTaskPayload(taskId, patch);
      return;
    }
    const ref = this.db.collection(COLLECTION).doc(DOC_ID);
    const snap = await ref.get();
    if (!snap.exists) return;
    const d = snap.data() as ScheduledTasksDocument;
    const now = admin.firestore.Timestamp.now();
    const tasks = (d.tasks ?? []).map((t) => {
      if (t.id !== taskId) return t;
      return sanitizeScheduledTaskForFirestore({
        ...t,
        payload: { ...(t.payload ?? {}), ...patch },
      });
    });
    await ref.set(
      { tasks: tasks.map(sanitizeScheduledTaskForFirestore), updatedAt: now },
      { merge: true },
    );
  }

  async recordLastRun(
    taskId: string,
    result: { ok?: boolean; error?: string | null; summary?: string | null },
  ): Promise<void> {
    if (useSqliteRelationalStore()) {
      const m = await import('../../storage/sqlite/scheduled-tasks.store');
      await m.sqliteRecordScheduledTaskLastRun(taskId, result);
      return;
    }
    const ref = this.db.collection(COLLECTION).doc(DOC_ID);
    const snap = await ref.get();
    if (!snap.exists) return;
    const d = snap.data() as ScheduledTasksDocument;
    const now = admin.firestore.Timestamp.now();
    const tasks = (d.tasks ?? []).map((t) => {
      if (t.id !== taskId) return t;
      const next: ScheduledTaskStored = { ...t, lastRunAt: now };
      if (typeof result.ok === 'boolean') next.lastRunOk = result.ok;
      else delete next.lastRunOk;
      const sum = result.summary != null ? String(result.summary).trim() : '';
      if (sum) next.lastRunSummary = sum;
      else delete next.lastRunSummary;
      if (result.error) next.lastError = result.error;
      else delete next.lastError;
      return next;
    });
    await ref.set(
      { tasks: tasks.map(sanitizeScheduledTaskForFirestore), updatedAt: now },
      { merge: true },
    );
  }
}

export function buildDefaultScheduledTasks(): ScheduledTaskStored[] {
  return defaultTasks();
}
