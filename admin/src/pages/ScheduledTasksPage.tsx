import { Alert, Button, Card, Checkbox, Input, InputNumber, Select, Space, Switch, Typography, message } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../api/admin';
import type { ScheduledTaskConfigRow } from '../types';

function patchPayload(task: ScheduledTaskConfigRow, partial: Record<string, unknown>): ScheduledTaskConfigRow {
  return { ...task, payload: { ...(task.payload ?? {}), ...partial } };
}

const MARKET_ROUND_ROBIN_KEY: ScheduledTaskConfigRow['taskKey'] = 'market_country_round_robin';

export function ScheduledTasksPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [tasks, setTasks] = useState<ScheduledTaskConfigRow[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [discountPersist, setDiscountPersist] = useState<string | null>(null);
  const [marketSyncState, setMarketSyncState] = useState<{
    countryQueue: string[];
    currentCountryCode: string | null;
    appidCursor: string;
    lastRunSummary: string | null;
  } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [out, syncOut] = await Promise.all([
        adminApi.getScheduledTasks(),
        adminApi.marketsSyncStatus().catch(() => ({ state: null })),
      ]);
      setTasks(out.tasks);
      setUpdatedAt(out.updatedAt);
      setDiscountPersist(out.discountOffersPersistence ?? null);
      setMarketSyncState(syncOut.state);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    const hasRunning = tasks.some((t) => String(t.lastRunSummary ?? '').includes('执行中'));
    const ms = hasRunning ? 15_000 : 60_000;
    const id = window.setInterval(() => void reload(), ms);
    return () => window.clearInterval(id);
  }, [reload, tasks]);

  const runNow = async (taskId: string) => {
    setRunningId(taskId);
    try {
      const out = await adminApi.runScheduledTaskNow(taskId);
      setTasks((prev) => prev.map((t) => (t.id === taskId ? out.task : t)));
      if (out.async) {
        message.info('已在后台执行，约 1～30 分钟后点「刷新状态」查看结果', 8);
        window.setTimeout(() => void reload(), 8000);
      } else {
        message.success('执行完成，已更新运行结果');
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '执行失败');
      await reload();
    } finally {
      setRunningId(null);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const out = await adminApi.putScheduledTasks({ tasks });
      setTasks(out.tasks);
      setUpdatedAt(out.updatedAt);
      message.success('已保存；服务端约 90 秒内重载 cron');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        定时任务
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        所有任务默认 <Typography.Text code>daily</Typography.Text> + <Typography.Text code>Asia/Shanghai</Typography.Text>，到点执行并更新下方「上次运行 / 结果」状态。
        本页每 60 秒自动刷新状态（有任务「执行中」时每 15 秒）。
        <Typography.Text code>hourly</Typography.Text> 为每整点；<Typography.Text code>daily</Typography.Text> 使用每日时刻（24h）；
        <Typography.Text code>every_n_hours</Typography.Text> 为每 N 小时（与 cron 对齐）。
      </Typography.Paragraph>
      <Alert
        type="success"
        showIcon
        style={{ marginBottom: 12 }}
        message="分国轮询实时状态"
        description={
          marketSyncState ? (
            <>
              当前国 <Typography.Text code>{marketSyncState.currentCountryCode ?? '—'}</Typography.Text>
              {' · '}
              队列 {marketSyncState.countryQueue.join(' → ') || '—'}
              {marketSyncState.appidCursor ? (
                <>
                  {' · '}
                  游标 <Typography.Text code>{marketSyncState.appidCursor}</Typography.Text>
                </>
              ) : null}
              {marketSyncState.lastRunSummary ? <> · {marketSyncState.lastRunSummary}</> : null}
            </>
          ) : (
            '暂无 market_sync_global_state（部署后跑一轮 market_country_round_robin 即可生成）'
          )
        }
      />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="分国市场 v2 存储"
        description={
          <>
            当前服务端模式：<Typography.Text code>{discountPersist ?? '—'}</Typography.Text>。
            分国轮询任务要求 <Typography.Text code>object_storage</Typography.Text>，写入{' '}
            <Typography.Text code>cache/markets/v2/&#123;CC&#125;/games/&#123;appid&#125;/</Typography.Text>
            （detail / heat / prices），索引在 SQLite <Typography.Text code>market_games</Typography.Text>。
            索引在 SQLite <Typography.Text code>market_games</Typography.Text>。
            T1 国家每日 01:00 同步 Top500；T2 国家每 2 天 04:00 同步 Top200；20:00 生成分国榜单 JSON。
          </>
        }
      />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="国家列表来源"
        description={
          <>
            折扣同步的国家来自侧边栏{' '}
            <a href="/admin/country-region-mapping">Country / Steam 映射</a>（接口{' '}
            <Typography.Text code>/api/admin/region-countries</Typography.Text>），不在任务里写死。
            默认使用映射页<strong>已启用</strong>的国家；若当前无任何启用国，则使用映射页<strong>全部配置</strong>国家。
          </>
        }
      />
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="Cloud Run 最小实例为 0 时，进程内 cron 休眠后不执行。请保持最小实例 ≥ 1，或 Cloud Scheduler 每日调用 POST /api/internal/cron/daily-schedules（Header X-Cron-Secret），依次跑完全部已启用任务并刷新状态。"
      />
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="「执行中」僵死与避免重复跑"
        description={
          <>
            异步「立即运行」在请求结束后实例可能被回收，状态会卡在「执行中」。长任务请加{' '}
            <Typography.Text code>?sync=1</Typography.Text>，或减小 <Typography.Text code>topN</Typography.Text> / 设置{' '}
            <Typography.Text code>maxCountries</Typography.Text>。计划任务默认{' '}
            <Typography.Text code>skipPriceSyncedToday</Typography.Text>，会跳过今日已同步折扣的游戏。超过 45 分钟仍显示执行中会自动标为中断。
          </>
        }
      />
      {updatedAt ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          配置更新时间：{updatedAt}
        </Typography.Paragraph>
      ) : null}

      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {tasks.map((t, i) => (
          <Card
            key={t.id}
            size="small"
            loading={loading}
            title={
              <Space wrap>
                <span>{t.label}</span>
                <Typography.Text type="secondary" code>
                  {t.taskKey}
                </Typography.Text>
              </Space>
            }
            extra={
              <Space wrap align="start" style={{ maxWidth: 480, textAlign: 'right' }}>
                <Button
                  type="primary"
                  size="small"
                  loading={runningId === t.id}
                  disabled={runningId != null && runningId !== t.id}
                  onClick={() => void runNow(t.id)}
                >
                  立即运行
                </Button>
                {t.lastRunAt ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
                    上次：{t.lastRunAt}
                  </Typography.Text>
                ) : null}
                {t.lastRunSummary?.includes('执行中') ? (
                  <Typography.Text type="warning" style={{ fontSize: 12, display: 'block' }}>
                    结果：执行中
                  </Typography.Text>
                ) : t.lastRunOk != null ? (
                  <Typography.Text
                    type={t.lastRunOk ? 'success' : 'danger'}
                    style={{ fontSize: 12, display: 'block' }}
                  >
                    结果：{t.lastRunOk ? '成功' : '失败'}
                  </Typography.Text>
                ) : null}
                {t.lastRunSummary ? (
                  <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', whiteSpace: 'pre-wrap' }}>
                    {t.lastRunSummary}
                  </Typography.Text>
                ) : null}
                {t.lastError ? (
                  <Typography.Text type="danger" style={{ fontSize: 12, display: 'block' }}>
                    {t.lastError}
                  </Typography.Text>
                ) : null}
              </Space>
            }
          >
            <Space wrap align="center" style={{ marginBottom: 12 }}>
              <span>启用</span>
              <Switch checked={t.enabled} onChange={(v) => setTasks((prev) => prev.map((x, j) => (j === i ? { ...x, enabled: v } : x)))} />
              <span>时区</span>
              <Input
                style={{ width: 220 }}
                value={t.timezone}
                onChange={(e) => setTasks((prev) => prev.map((x, j) => (j === i ? { ...x, timezone: e.target.value } : x)))}
                placeholder="America/New_York"
              />
              <span>频率</span>
              <Select
                style={{ width: 160 }}
                value={t.frequency}
                onChange={(v) =>
                  setTasks((prev) =>
                    prev.map((x, j) =>
                      j === i ? { ...x, frequency: v, timeOfDay: v === 'daily' ? x.timeOfDay ?? '03:00' : undefined, everyHours: v === 'every_n_hours' ? x.everyHours ?? 1 : undefined } : x,
                    ),
                  )
                }
                options={[
                  { value: 'daily', label: 'daily（每日）' },
                  { value: 'hourly', label: 'hourly（每整点）' },
                  { value: 'every_n_hours', label: 'every_n_hours（每 N 小时）' },
                ]}
              />
              {t.frequency === 'daily' ? (
                <>
                  <span>时刻 HH:mm</span>
                  <Input
                    style={{ width: 96 }}
                    value={t.timeOfDay ?? ''}
                    onChange={(e) => setTasks((prev) => prev.map((x, j) => (j === i ? { ...x, timeOfDay: e.target.value } : x)))}
                    placeholder="03:00"
                  />
                </>
              ) : null}
              {t.frequency === 'every_n_hours' ? (
                <>
                  <span>每 N 小时</span>
                  <InputNumber
                    min={1}
                    max={23}
                    value={t.everyHours ?? 1}
                    onChange={(v) =>
                      setTasks((prev) => prev.map((x, j) => (j === i ? { ...x, everyHours: Math.max(1, Math.min(23, Number(v) || 1)) } : x)))
                    }
                  />
                </>
              ) : null}
            </Space>

            {t.taskKey === MARKET_ROUND_ROBIN_KEY ? (
              <Space wrap align="center">
                <Typography.Text type="secondary">
                  单国轮询：每批同步详情+热度+四平台价，写入 cache/markets/v2/{'{CC}'}/…；游标在 SQLite market_sync_global_state
                </Typography.Text>
                <span>每国 TopN</span>
                <InputNumber
                  min={50}
                  max={500}
                  value={Number(t.payload?.topNPerCountry ?? 200)}
                  onChange={(v) =>
                    setTasks((prev) => prev.map((x, j) => (j === i ? patchPayload(x, { topNPerCountry: Number(v) || 200 }) : x)))
                  }
                />
                <span>每批游戏数</span>
                <InputNumber
                  min={10}
                  max={200}
                  value={Number(t.payload?.batchSize ?? 50)}
                  onChange={(v) => setTasks((prev) => prev.map((x, j) => (j === i ? patchPayload(x, { batchSize: Number(v) || 50 }) : x)))}
                />
                <span>delayMs</span>
                <InputNumber
                  min={0}
                  max={3000}
                  value={Number(t.payload?.delayMs ?? 50)}
                  onChange={(v) => setTasks((prev) => prev.map((x, j) => (j === i ? patchPayload(x, { delayMs: Number(v) ?? 50 }) : x)))}
                />
                <Checkbox
                  checked={t.payload?.skipSyncedToday !== false}
                  onChange={(e) =>
                    setTasks((prev) => prev.map((x, j) => (j === i ? patchPayload(x, { skipSyncedToday: e.target.checked }) : x)))
                  }
                >
                  跳过今日已完整同步的游戏
                </Checkbox>
              </Space>
            ) : t.taskKey === 'market_build_lists' ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                从 market_games 索引生成各国 <Typography.Text code>top-discounts</Typography.Text> 与{' '}
                <Typography.Text code>top-heat</Typography.Text> 列表 JSON。
              </Typography.Text>
            ) : t.taskKey === 'build_public_cache' ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                从对象存储折扣分桶 + 目录聚合生成 <Typography.Text code>cache/top-discounts-*</Typography.Text>、
                <Typography.Text code>hot-deals</Typography.Text>、<Typography.Text code>*-prices.json</Typography.Text> 等（需已配置 GCS/R2 桶与
                PUBLIC_CACHE_CDN_BASE）。
              </Typography.Text>
            ) : t.taskKey === 'cleanup_invalid_deal_links' ? (
              <Space wrap align="center">
                <Typography.Text type="secondary">单次运行最多删除条数</Typography.Text>
                <InputNumber
                  min={0}
                  max={50000}
                  value={Number(t.payload?.maxDelete ?? 5000)}
                  onChange={(v) => setTasks((prev) => prev.map((x, j) => (j === i ? patchPayload(x, { maxDelete: Number(v) ?? 5000 }) : x)))}
                />
              </Space>
            ) : (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                此任务无额外参数（payload 可为空对象）。
              </Typography.Text>
            )}
          </Card>
        ))}
      </Space>

      <Space style={{ marginTop: 16 }} wrap>
        <Button type="primary" loading={saving} disabled={loading || tasks.length === 0} onClick={() => void save()}>
          保存全部
        </Button>
        <Button loading={loading} onClick={() => void reload()}>
          刷新状态
        </Button>
        <Button
          type="primary"
          ghost
          loading={runningAll}
          disabled={loading || runningId != null}
          onClick={async () => {
            setRunningAll(true);
            try {
              const out = await adminApi.runAllScheduledTasksEnabled();
              if (out.async) {
                message.info(out.message ?? '已在后台执行全部任务，请稍后查看状态', 8);
                window.setTimeout(() => void reload(), 10_000);
              } else if (out.tasks) {
                setTasks(out.tasks);
                setUpdatedAt(out.updatedAt ?? null);
                message.success(`已完成 ${out.results?.length ?? 0} 个任务`);
              }
            } catch (e) {
              message.error(e instanceof Error ? e.message : '执行失败');
            } finally {
              setRunningAll(false);
            }
          }}
        >
          立即运行全部已启用
        </Button>
      </Space>
    </div>
  );
}
