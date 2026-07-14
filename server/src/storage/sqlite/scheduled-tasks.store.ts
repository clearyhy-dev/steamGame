import admin from 'firebase-admin';
import type {
  ScheduledTaskStored,
  ScheduledTasksDocument,
} from '../../modules/admin/scheduled-tasks.repository';
import { buildDefaultScheduledTasks } from '../../modules/admin/scheduled-tasks.repository';
import { sqlAll, sqlGet, sqlRun } from './sql-client';
import { msToTimestamp, nowMs, timestampToMs } from './timestamp';

type TaskRow = {
  id: string;
  label: string;
  enabled: number;
  task_key: string;
  timezone: string;
  frequency: string;
  time_of_day: string | null;
  every_hours: number | null;
  payload_json: string;
  last_run_at_ms: number | null;
  last_run_ok: number | null;
  last_run_summary: string | null;
  last_error: string | null;
};

function rowToTask(r: TaskRow): ScheduledTaskStored {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(r.payload_json) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  const t: ScheduledTaskStored = {
    id: r.id,
    label: r.label,
    enabled: r.enabled === 1,
    taskKey: r.task_key as ScheduledTaskStored['taskKey'],
    timezone: r.timezone,
    frequency: r.frequency as ScheduledTaskStored['frequency'],
    payload,
  };
  if (r.time_of_day) t.timeOfDay = r.time_of_day;
  if (r.every_hours != null) t.everyHours = r.every_hours;
  const lastRun = msToTimestamp(r.last_run_at_ms);
  if (lastRun) t.lastRunAt = lastRun;
  if (r.last_run_ok != null) t.lastRunOk = r.last_run_ok === 1;
  if (r.last_run_summary) t.lastRunSummary = r.last_run_summary;
  if (r.last_error) t.lastError = r.last_error;
  return t;
}

async function upsertTaskRow(t: ScheduledTaskStored): Promise<void> {
  await sqlRun(
    `INSERT INTO scheduled_tasks (
      id, label, enabled, task_key, timezone, frequency, time_of_day, every_hours, payload_json,
      last_run_at_ms, last_run_ok, last_run_summary, last_error
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      label=excluded.label, enabled=excluded.enabled, task_key=excluded.task_key,
      timezone=excluded.timezone, frequency=excluded.frequency, time_of_day=excluded.time_of_day,
      every_hours=excluded.every_hours, payload_json=excluded.payload_json,
      last_run_at_ms=excluded.last_run_at_ms, last_run_ok=excluded.last_run_ok,
      last_run_summary=excluded.last_run_summary, last_error=excluded.last_error`,
    [
      t.id,
      t.label,
      t.enabled ? 1 : 0,
      t.taskKey,
      t.timezone,
      t.frequency,
      t.timeOfDay ?? null,
      t.everyHours ?? null,
      JSON.stringify(t.payload ?? {}),
      timestampToMs(t.lastRunAt) ?? null,
      typeof t.lastRunOk === 'boolean' ? (t.lastRunOk ? 1 : 0) : null,
      t.lastRunSummary ?? null,
      t.lastError ?? null,
    ],
  );
}

async function ensureMeta(createdMs?: number): Promise<{ createdAt: admin.firestore.Timestamp; updatedAt: admin.firestore.Timestamp }> {
  const now = nowMs();
  const row = await sqlGet<{ created_at_ms: number; updated_at_ms: number }>(
    'SELECT created_at_ms, updated_at_ms FROM scheduled_tasks_meta WHERE id = 1',
  );
  if (!row) {
    const c = createdMs ?? now;
    await sqlRun('INSERT INTO scheduled_tasks_meta (id, created_at_ms, updated_at_ms) VALUES (1,?,?)', [c, now]);
    return { createdAt: msToTimestamp(c)!, updatedAt: msToTimestamp(now)! };
  }
  await sqlRun('UPDATE scheduled_tasks_meta SET updated_at_ms = ? WHERE id = 1', [now]);
  return {
    createdAt: msToTimestamp(row.created_at_ms)!,
    updatedAt: msToTimestamp(now)!,
  };
}

export async function sqliteGetScheduledTasks(): Promise<ScheduledTasksDocument> {
  const rows = await sqlAll<TaskRow>('SELECT * FROM scheduled_tasks ORDER BY id ASC');
  const defaults = buildDefaultScheduledTasks();
  if (rows.length === 0) {
    const now = admin.firestore.Timestamp.now();
    for (const t of defaults) await upsertTaskRow(t);
    const meta = await ensureMeta(nowMs());
    return { tasks: defaults, createdAt: meta.createdAt, updatedAt: meta.updatedAt };
  }
  const byId = new Map(rows.map((r) => [r.id, rowToTask(r)]));
  const merged = [...defaults.map((d) => byId.get(d.id) ?? d)];
  for (const [id, t] of byId) {
    if (!merged.some((x) => x.id === id)) merged.push(t);
  }
  const meta = await ensureMeta();
  return { tasks: merged, createdAt: meta.createdAt, updatedAt: meta.updatedAt };
}

export async function sqliteSaveScheduledTasks(tasks: ScheduledTaskStored[]): Promise<ScheduledTasksDocument> {
  const prev = await sqliteGetScheduledTasks();
  const prevById = new Map(prev.tasks.map((t) => [t.id, t]));
  const merged = tasks.map((t) => {
    const old = prevById.get(t.id);
    if (!old) return t;
    return {
      ...t,
      lastRunAt: old.lastRunAt,
      lastRunOk: old.lastRunOk,
      lastRunSummary: old.lastRunSummary,
      lastError: old.lastError,
    };
  });
  for (const t of merged) await upsertTaskRow(t);
  const meta = await ensureMeta(timestampToMs(prev.createdAt));
  return { tasks: merged, createdAt: meta.createdAt, updatedAt: meta.updatedAt };
}

export async function sqliteClearStaleRunningTasks(maxAgeMs: number): Promise<number> {
  const doc = await sqliteGetScheduledTasks();
  const nowMsVal = nowMs();
  let cleared = 0;
  const tasks = doc.tasks.map((t) => {
    const sum = String(t.lastRunSummary ?? '');
    if (!sum.includes('执行中')) return t;
    const atMs = timestampToMs(t.lastRunAt) ?? 0;
    if (atMs > 0 && nowMsVal - atMs < maxAgeMs) return t;
    cleared += 1;
    return {
      ...t,
      lastRunOk: false,
      lastRunSummary: '上次执行中断（Cloud Run 实例回收或超时），可重新「立即运行」',
      lastError: 'stale_running_cleared',
    };
  });
  if (cleared === 0) return 0;
  await sqliteSaveScheduledTasks(tasks);
  return cleared;
}

export async function sqliteDisableAllTasksAndClearRunning(): Promise<ScheduledTasksDocument> {
  const doc = await sqliteGetScheduledTasks();
  const tasks = doc.tasks.map((t) => {
    const next = { ...t, enabled: false };
    if (String(t.lastRunSummary ?? '').includes('执行中')) {
      next.lastRunOk = false;
      next.lastRunSummary = '已人工紧急停止（不再扣费）';
      next.lastError = undefined;
    }
    return next;
  });
  return sqliteSaveScheduledTasks(tasks);
}

export async function sqlitePatchScheduledTaskPayload(
  taskId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const doc = await sqliteGetScheduledTasks();
  const tasks = doc.tasks.map((t) =>
    t.id === taskId ? { ...t, payload: { ...(t.payload ?? {}), ...patch } } : t,
  );
  await sqliteSaveScheduledTasks(tasks);
}

export async function sqliteRecordScheduledTaskLastRun(
  taskId: string,
  result: { ok?: boolean; error?: string | null; summary?: string | null },
): Promise<void> {
  const doc = await sqliteGetScheduledTasks();
  const task = doc.tasks.find((t) => t.id === taskId);
  if (!task) return;
  const now = admin.firestore.Timestamp.now();
  const next: ScheduledTaskStored = { ...task, lastRunAt: now };
  if (typeof result.ok === 'boolean') next.lastRunOk = result.ok;
  else delete next.lastRunOk;
  const sum = result.summary != null ? String(result.summary).trim() : '';
  if (sum) next.lastRunSummary = sum;
  else delete next.lastRunSummary;
  if (result.error) next.lastError = result.error;
  else delete next.lastError;
  await upsertTaskRow(next);
  await ensureMeta();
}
