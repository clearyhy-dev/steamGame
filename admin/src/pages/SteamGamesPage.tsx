import { Button, Card, Collapse, Descriptions, Image, Input, InputNumber, Modal, Popover, Select, Space, Switch, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../api/admin';
import type { DealLinkRow, GameDetailResponse, GameManageRow, SteamSyncJobRow } from '../types';

const NAME_COL_WIDTH = 240;
const NAME_TRUNC_PX = 220;

/** 固定宽度省略；点击浮层查看完整名称 */
function GameNameCell({ text }: { text?: string }) {
  const s = text ?? '';
  if (!s) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <Popover
      content={
        <div style={{ maxWidth: 480, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{s}</div>
      }
      trigger="click"
      placement="topLeft"
    >
      <Typography.Text
        ellipsis={{ tooltip: false }}
        style={{
          maxWidth: NAME_TRUNC_PX,
          display: 'inline-block',
          verticalAlign: 'bottom',
          cursor: 'pointer',
        }}
      >
        {s}
      </Typography.Text>
    </Popover>
  );
}

export function SteamGamesPage() {
  const [rows, setRows] = useState<GameManageRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [appid, setAppid] = useState('');
  const [keyword, setKeyword] = useState('');
  const [minDiscountPercent, setMinDiscountPercent] = useState<number>(0);
  const [discountSource, setDiscountSource] = useState<'all' | 'steam' | 'isthereanydeal' | 'ggdeals' | 'cheapshark'>('all');
  const [discountCountry, setDiscountCountry] = useState('');
  const [hotnessMin, setHotnessMin] = useState<number>(0);
  const [hasDiscountInfo, setHasDiscountInfo] = useState<'all' | 'yes' | 'no'>('all');
  const [hasDealLink, setHasDealLink] = useState<'all' | 'yes' | 'no'>('all');
  const [hasDetailSynced, setHasDetailSynced] = useState<'all' | 'yes' | 'no'>('all');
  const [querySeq, setQuerySeq] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<GameDetailResponse | null>(null);
  const [discountUrl, setDiscountUrl] = useState('');
  const [dealDraft, setDealDraft] = useState<{
    source: DealLinkRow['source'];
    url: string;
    isAffiliate: boolean;
    isActive: boolean;
    priority: number;
    startAt?: string | null;
    endAt?: string | null;
  }>({
    source: 'manual',
    url: '',
    isAffiliate: false,
    isActive: true,
    priority: 100,
    startAt: '',
    endAt: '',
  });
  const [reviewsPages, setReviewsPages] = useState<number>(20);
  const [syncingBatch, setSyncingBatch] = useState(false);
  const [syncingDealsBatch, setSyncingDealsBatch] = useState(false);
  const [detailSyncOffset, setDetailSyncOffset] = useState(0);
  const [detailCursorAppid, setDetailCursorAppid] = useState('');
  const [dealCursorAppid, setDealCursorAppid] = useState('');
  const [detailSyncRows, setDetailSyncRows] = useState<
    Array<{ appid: string; status: 'synced' | 'skipped' | 'failed'; message?: string; name?: string; currentPlayers?: number; discountPercent?: number; priceFinal?: number }>
  >([]);
  const [appListCursor, setAppListCursor] = useState(0);
  const [syncJobs, setSyncJobs] = useState<SteamSyncJobRow[]>([]);
  const [dealCoverage, setDealCoverage] = useState<Array<{ source: string; ok: number; empty: number; failed: number }>>([]);
  const [dealBatchRows, setDealBatchRows] = useState<Array<{ appid: string; name?: string; ok: boolean; upserted: number; inserted?: number; updated?: number; deduped?: number; message?: string }>>([]);
  const [dealBatchMeta, setDealBatchMeta] = useState<{ cursorStart?: string | null; cursorEnd?: string | null; requestedBatchSize?: number; staleMarked?: number; staleScanned?: number }>({});

  const load = async () => {
    setLoading(true);
    try {
      const out = await adminApi.games({
        appid: appid.trim() || undefined,
        keyword: keyword.trim() || undefined,
        discount_percent: minDiscountPercent || undefined,
        has_deal_link: hasDealLink === 'all' ? undefined : hasDealLink === 'yes',
        has_detail_synced: hasDetailSynced === 'all' ? undefined : hasDetailSynced === 'yes',
        discount_source: discountSource === 'all' ? undefined : discountSource,
        discount_country: discountCountry.trim() || undefined,
        has_discount_info: hasDiscountInfo === 'all' ? undefined : hasDiscountInfo === 'yes',
        hotness_min: hotnessMin || undefined,
        page,
        pageSize,
        sortBy: 'online_desc',
      });
      setRows(out.rows);
      setTotal(out.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [querySeq, page, pageSize]);

  const runQuery = () => {
    setPage(1);
    setQuerySeq((v) => v + 1);
  };

  const syncDealsBySources = async (sources: Array<'steam' | 'isthereanydeal' | 'ggdeals' | 'cheapshark'>) => {
    setSyncingDealsBatch(true);
    try {
      const out = await adminApi.syncGameDealsBatch({
        batchSize: 100,
        delayMs: 80,
        cursorAppid: dealCursorAppid || undefined,
        sources,
      });
      setDealCursorAppid(out.nextCursorAppid ?? '');
      setDealCoverage(out.coverage ?? []);
      setDealBatchRows(out.rows ?? []);
      setDealBatchMeta({
        cursorStart: out.cursorStart,
        cursorEnd: out.cursorEnd,
        requestedBatchSize: out.requestedBatchSize,
        staleMarked: out.staleMarked,
        staleScanned: out.staleScanned,
      });
      message.success(`批量折扣(${sources.join(',')}): 成功${out.success}, 失败${out.failed}`);
      setQuerySeq((v) => v + 1);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '按平台批量折扣同步失败');
    } finally {
      setSyncingDealsBatch(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const out = await adminApi.gameSyncJobs({ limit: 20 });
        setSyncJobs(out.rows);
      } catch {
        setSyncJobs([]);
      }
    })();
  }, [loading]);

  const openDetail = async (targetAppid: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const out = await adminApi.gameDetail(targetAppid, { allReviews: true });
      setDetail(out);
      setDiscountUrl(out.game.discountUrl || '');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载详情失败');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const cols: ColumnsType<GameManageRow> = [
    {
      title: '#',
      key: 'idx',
      width: 70,
      render: (_, __, index) => (page - 1) * pageSize + index + 1,
    },
    {
      title: 'image',
      dataIndex: 'headerImage',
      width: 72,
      render: (url?: string) =>
        url ? <Image src={url} width={56} height={56} style={{ objectFit: 'cover' }} /> : '—',
    },
    {
      title: 'appid',
      dataIndex: 'appid',
      width: 90,
      render: (v: string) => (
        <a
          onClick={() => {
            void openDetail(v);
          }}
        >
          {v}
        </a>
      ),
    },
    {
      title: 'name',
      dataIndex: 'name',
      width: NAME_COL_WIDTH,
      ellipsis: { showTitle: false },
      render: (t: string) => <GameNameCell text={t} />,
    },
    { title: 'online', dataIndex: 'currentPlayers', width: 100, render: (v?: number) => v ?? 0 },
    { title: 'orig', dataIndex: 'originalPrice', width: 90, render: (v?: number) => (typeof v === 'number' ? v : '-') },
    { title: 'discount%', dataIndex: 'discountPercent', width: 110, render: (v: number) => `${v ?? 0}%` },
    { title: 'steam%', dataIndex: 'steamDiscountPercent', width: 90, render: (v?: number | null) => (typeof v === 'number' ? `${v}%` : '-') },
    { title: 'itad%', dataIndex: 'itadDiscountPercent', width: 90, render: (v?: number | null) => (typeof v === 'number' ? `${v}%` : '-') },
    { title: 'gg%', dataIndex: 'ggDealsDiscountPercent', width: 90, render: (v?: number | null) => (typeof v === 'number' ? `${v}%` : '-') },
    { title: 'cheap%', dataIndex: 'cheapSharkDiscountPercent', width: 90, render: (v?: number | null) => (typeof v === 'number' ? `${v}%` : '-') },
    { title: 'hot(max)', dataIndex: 'maxHotnessScore', width: 110, render: (v?: number) => (typeof v === 'number' ? v : '-') },
    {
      title: 'hasDeal',
      dataIndex: 'hasDealLink',
      width: 100,
      render: (v: boolean) => (v ? <Tag color="green">yes</Tag> : <Tag>no</Tag>),
    },
    {
      title: 'detail',
      dataIndex: 'detailSynced',
      width: 90,
      render: (v?: boolean) => (v ? <Tag color="blue">synced</Tag> : <Tag>unsynced</Tag>),
    },
    { title: 'clicks', dataIndex: 'clickCount', width: 100 },
    { title: 'linkedVideos', dataIndex: 'linkedVideos', width: 120 },
    {
      title: '操作',
      key: 'op',
      width: 180,
      render: (_, r) => (
        <Space wrap>
          <Button
            size="small"
            onClick={async () => {
              try {
                await openDetail(r.appid);
              } catch (e) {
                message.error(e instanceof Error ? e.message : '加载详情失败');
              }
            }}
          >
            查看详情
          </Button>
          <Button
            size="small"
            type="primary"
            onClick={async () => {
              try {
                await adminApi.createSteamSource({
                  gameId: r.appid, // keep one-game-one-id strategy
                  steamAppId: r.appid,
                  title: r.name || `Steam ${r.appid}`,
                  ingestMode: 'process',
                  priority: 0,
                });
                message.success('已加入视频来源');
              } catch (e) {
                message.error(e instanceof Error ? e.message : '创建视频来源失败');
              }
            }}
          >
            加入视频来源
          </Button>
          <Button
            size="small"
            onClick={async () => {
              try {
                await adminApi.syncGameDetail(r.appid);
                message.success('已同步游戏详情');
                await openDetail(r.appid);
                void load();
              } catch (e) {
                message.error(e instanceof Error ? e.message : '同步失败');
              }
            }}
          >
            同步详情
          </Button>
          <Button
            size="small"
            onClick={async () => {
              try {
                const out = await adminApi.syncGameDeals(r.appid);
                message.success(`已实时同步折扣: ${out.upserted}`);
                await openDetail(r.appid);
                void load();
              } catch (e) {
                message.error(e instanceof Error ? e.message : '折扣同步失败');
              }
            }}
          >
            实时折扣
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          placeholder="appid"
          value={appid}
          onChange={(e) => setAppid(e.target.value)}
          style={{ width: 120 }}
        />
        <Input
          placeholder="name keyword"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 180 }}
        />
        <InputNumber min={0} max={100} value={minDiscountPercent} onChange={(v) => setMinDiscountPercent(Number(v || 0))} />
        <Select
          value={discountSource}
          onChange={(v) => setDiscountSource(v)}
          style={{ width: 160 }}
          options={[
            { label: 'source: all', value: 'all' },
            { label: 'steam', value: 'steam' },
            { label: 'itad', value: 'isthereanydeal' },
            { label: 'gg.deals', value: 'ggdeals' },
            { label: 'cheapshark', value: 'cheapshark' },
          ]}
        />
        <Input
          placeholder="country(US/CN/JP)"
          value={discountCountry}
          onChange={(e) => setDiscountCountry(e.target.value.toUpperCase())}
          style={{ width: 140 }}
        />
        <InputNumber min={0} max={999} value={hotnessMin} onChange={(v) => setHotnessMin(Number(v || 0))} placeholder="hotness>=" />
        <Select
          value={hasDiscountInfo}
          onChange={(v) => setHasDiscountInfo(v)}
          style={{ width: 150 }}
          options={[
            { label: 'discount: all', value: 'all' },
            { label: 'discount: yes', value: 'yes' },
            { label: 'discount: no', value: 'no' },
          ]}
        />
        <Select
          value={hasDealLink}
          onChange={(v) => setHasDealLink(v)}
          style={{ width: 120 }}
          options={[
            { label: 'deal: all', value: 'all' },
            { label: 'deal: yes', value: 'yes' },
            { label: 'deal: no', value: 'no' },
          ]}
        />
        <Select
          value={hasDetailSynced}
          onChange={(v) => setHasDetailSynced(v)}
          style={{ width: 140 }}
          options={[
            { label: 'detail: all', value: 'all' },
            { label: 'detail: synced', value: 'yes' },
            { label: 'detail: unsynced', value: 'no' },
          ]}
        />
        <Button
          type="primary"
          onClick={runQuery}
        >
          查询
        </Button>
        <Button
          loading={syncingDealsBatch}
          onClick={async () => {
            setSyncingDealsBatch(true);
            try {
              const out = await adminApi.syncGameDealsBatch({
                batchSize: 100,
                delayMs: 80,
                cursorAppid: dealCursorAppid || undefined,
              });
              setDealCursorAppid(out.nextCursorAppid ?? '');
              setDealCoverage(out.coverage ?? []);
              setDealBatchRows(out.rows ?? []);
              setDealBatchMeta({
                cursorStart: out.cursorStart,
                cursorEnd: out.cursorEnd,
                requestedBatchSize: out.requestedBatchSize,
                staleMarked: out.staleMarked,
                staleScanned: out.staleScanned,
              });
              message.success(`折扣批量完成: 成功${out.success}, 失败${out.failed}`);
              void load();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '批量折扣同步失败');
            } finally {
              setSyncingDealsBatch(false);
            }
          }}
        >
          批量获取折扣(100)
        </Button>
        <Button loading={syncingDealsBatch} onClick={() => void syncDealsBySources(['steam'])}>
          Steam折扣批量
        </Button>
        <Button loading={syncingDealsBatch} onClick={() => void syncDealsBySources(['isthereanydeal'])}>
          ITAD折扣批量
        </Button>
        <Button loading={syncingDealsBatch} onClick={() => void syncDealsBySources(['ggdeals'])}>
          GG折扣批量
        </Button>
        <Button loading={syncingDealsBatch} onClick={() => void syncDealsBySources(['cheapshark'])}>
          CheapShark折扣批量
        </Button>
        <Button
          loading={syncingDealsBatch}
          onClick={async () => {
            setSyncingDealsBatch(true);
            try {
              const out = await adminApi.syncGameDealsHotTop({ topN: 100, delayMs: 80, staleTtlHours: 6 });
              setDealCoverage(out.coverage ?? []);
              setDealBatchRows(out.rows ?? []);
              setDealBatchMeta({
                cursorStart: out.cursorStart,
                cursorEnd: out.cursorEnd,
                requestedBatchSize: out.requestedBatchSize,
                staleMarked: out.staleMarked,
                staleScanned: out.staleScanned,
              });
              message.success(`热度Top100更新完成: 成功${out.success}, 失败${out.failed}`);
              void load();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '热度Top更新失败');
            } finally {
              setSyncingDealsBatch(false);
            }
          }}
        >
          热度Top100更新
        </Button>
        <Button
          loading={syncingDealsBatch}
          onClick={async () => {
            setSyncingDealsBatch(true);
            try {
              const out = await adminApi.syncGameDealsBatch({
                batchSize: 100,
                delayMs: 80,
                cursorAppid: dealCursorAppid || undefined,
              });
              setDealCursorAppid(out.nextCursorAppid ?? dealCursorAppid);
              setDealCoverage(out.coverage ?? []);
              setDealBatchRows(out.rows ?? []);
              setDealBatchMeta({
                cursorStart: out.cursorStart,
                cursorEnd: out.cursorEnd,
                requestedBatchSize: out.requestedBatchSize,
                staleMarked: out.staleMarked,
                staleScanned: out.staleScanned,
              });
              message.success(`继续折扣同步: 成功${out.success}, 失败${out.failed}`);
              void load();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '继续折扣同步失败');
            } finally {
              setSyncingDealsBatch(false);
            }
          }}
        >
          继续获取下一批折扣
        </Button>
        <Button
          onClick={async () => {
            try {
              const out = await adminApi.syncAppList({ chunkSize: 400 });
              setAppListCursor(out.nextLastAppId ?? 0);
              message.success(`AppList同步: +${out.inserted}, 更新${out.updated}, hasMore=${out.hasMore}`);
              const jobs = await adminApi.gameSyncJobs({ limit: 20 });
              setSyncJobs(jobs.rows);
              void load();
            } catch (e) {
              message.error(e instanceof Error ? e.message : 'AppList同步失败');
            }
          }}
        >
          同步 Steam AppList
        </Button>
        <Button
          onClick={async () => {
            try {
              const out = await adminApi.syncAppList({ chunkSize: 400, maxResults: 5000, lastAppId: appListCursor });
              setAppListCursor(out.nextLastAppId ?? appListCursor);
              message.success(`继续导入: +${out.inserted}, 更新${out.updated}, hasMore=${out.hasMore}`);
              void load();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '继续导入失败');
            }
          }}
        >
          继续导入下一批AppList
        </Button>
        <Button
          loading={syncingBatch}
          onClick={async () => {
            setSyncingBatch(true);
            try {
              const out = await adminApi.syncGameDetailsBatch({ batchSize: 200, delayMs: 120, concurrency: 4, force: false });
              setDetailSyncRows(out.rows);
              message.success(`详情批量同步完成: 成功${out.success}, 跳过${out.skipped}, 失败${out.failed}`);
              setDetailSyncOffset(out.nextOffset ?? 0);
              setDetailCursorAppid(out.nextCursorAppid ?? '');
              if (out.reachedEnd) setDetailCursorAppid('');
              const jobs = await adminApi.gameSyncJobs({ limit: 20 });
              setSyncJobs(jobs.rows);
              void load();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '批量同步失败');
            } finally {
              setSyncingBatch(false);
            }
          }}
        >
          批量同步详情(200)
        </Button>
        <Button
          onClick={async () => {
            setSyncingBatch(true);
            try {
              const out = await adminApi.syncGameDetailsBatch({
                batchSize: 200,
                delayMs: 120,
                concurrency: 4,
                offset: detailSyncOffset,
                cursorAppid: detailCursorAppid,
                force: false,
              });
              setDetailSyncRows(out.rows);
              setDetailSyncOffset(out.nextOffset ?? detailSyncOffset);
              setDetailCursorAppid(out.nextCursorAppid ?? detailCursorAppid);
              if (out.reachedEnd) setDetailCursorAppid('');
              message.success(
                `继续同步完成: 成功${out.success}, 跳过${out.skipped}, 失败${out.failed}, nextOffset=${out.nextOffset}`,
              );
              void load();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '继续同步失败');
            } finally {
              setSyncingBatch(false);
            }
          }}
        >
          继续同步下一批
        </Button>
        <Button onClick={() => void load()}>刷新</Button>
      </Space>

      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        共 {total} 个游戏，当前展示 {rows.length} 个（按 appid 去重；可关联多个视频）。批量详情每次最多处理 200
        条未同步项；全库同步需多次点击「继续同步下一批」直至无更多。Steam 偶发失败会自动重试；仍失败多为商店无该 app。
      </Typography.Paragraph>

      <Collapse
        defaultActiveKey={[]}
        items={[
          {
            key: 'coverage',
            label: '平台覆盖率面板（本次批量折扣）',
            children: (
              <Table
                size="small"
                rowKey={(r) => r.source}
                pagination={false}
                dataSource={dealCoverage}
                columns={[
                  { title: 'platform', dataIndex: 'source', width: 140 },
                  { title: 'success', dataIndex: 'ok', width: 100 },
                  { title: 'empty', dataIndex: 'empty', width: 100 },
                  { title: 'failed', dataIndex: 'failed', width: 100 },
                ]}
              />
            ),
          },
        ]}
        style={{ marginBottom: 12 }}
      />
      <Collapse
        defaultActiveKey={[]}
        items={[
          {
            key: 'dealBatchRows',
            label: `折扣批量抓取明细（本次 ${dealBatchRows.length} 条）`,
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  batchSize={dealBatchMeta.requestedBatchSize ?? '-'} | cursorStart={dealBatchMeta.cursorStart ?? '-'} | cursorEnd={dealBatchMeta.cursorEnd ?? '-'}
                </Typography.Paragraph>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  staleMarked={dealBatchMeta.staleMarked ?? 0} | staleScanned={dealBatchMeta.staleScanned ?? 0}
                </Typography.Paragraph>
                <Table
                  size="small"
                  rowKey={(r) => r.appid}
                  pagination={{ pageSize: 10 }}
                  dataSource={dealBatchRows}
                  columns={[
                    { title: 'appid', dataIndex: 'appid', width: 100 },
                    { title: 'name', dataIndex: 'name', width: 240, ellipsis: true },
                    { title: 'status', dataIndex: 'ok', width: 90, render: (v: boolean) => (v ? <Tag color="green">ok</Tag> : <Tag color="red">fail</Tag>) },
                    { title: 'upserted', dataIndex: 'upserted', width: 90 },
                    { title: 'inserted', dataIndex: 'inserted', width: 90 },
                    { title: 'updated', dataIndex: 'updated', width: 90 },
                    { title: 'deduped', dataIndex: 'deduped', width: 90 },
                    { title: 'message', dataIndex: 'message', ellipsis: true },
                  ]}
                />
              </>
            ),
          },
        ]}
        style={{ marginBottom: 12 }}
      />
      <Collapse
        defaultActiveKey={[]}
        items={[
          {
            key: 'jobs',
            label: 'Steam 同步任务记录',
            children: (
              <Table
                size="small"
                rowKey="jobId"
                pagination={{ pageSize: 5 }}
                dataSource={syncJobs}
                columns={[
                  { title: 'time', dataIndex: 'createdAt', width: 180 },
                  { title: 'trigger', dataIndex: 'trigger', width: 150 },
                  { title: 'status', dataIndex: 'status', width: 100, render: (v: string) => <Tag>{v}</Tag> },
                  { title: 'appList +new', dataIndex: 'appListInserted', width: 110 },
                  { title: 'detail ok/fail', width: 130, render: (_, r) => `${r.detailSuccess}/${r.detailFailed}` },
                  { title: 'elapsed(ms)', dataIndex: 'elapsedMs', width: 120 },
                ]}
              />
            ),
          },
        ]}
        style={{ marginBottom: 12 }}
      />

      <Table
        rowKey={(r) => r.appid}
        loading={loading}
        columns={cols}
        dataSource={rows}
        scroll={{ x: true }}
        pagination={{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          onChange: (p, ps) => {
            setPage(p);
            setPageSize(ps);
          },
        }}
      />

      <Collapse
        defaultActiveKey={[]}
        items={[
          {
            key: 'detailRows',
            label: `本次详情同步明细 (${detailSyncRows.length})`,
            children: (
              <Table
                size="small"
                rowKey={(r) => `${r.appid}_${r.status}`}
                dataSource={detailSyncRows}
                pagination={{ pageSize: 8 }}
                columns={[
                  { title: 'appid', dataIndex: 'appid', width: 110 },
                  {
                    title: 'name',
                    dataIndex: 'name',
                    width: NAME_COL_WIDTH,
                    ellipsis: { showTitle: false },
                    render: (t?: string) => <GameNameCell text={t} />,
                  },
                  { title: 'status', dataIndex: 'status', width: 90, render: (v: string) => <Tag>{v}</Tag> },
                  { title: 'online', dataIndex: 'currentPlayers', width: 90, render: (v?: number) => v ?? '-' },
                  { title: 'discount%', dataIndex: 'discountPercent', width: 100, render: (v?: number) => (typeof v === 'number' ? `${v}%` : '-') },
                  { title: 'priceFinal', dataIndex: 'priceFinal', width: 100, render: (v?: number) => (typeof v === 'number' ? v : '-') },
                  { title: 'message', dataIndex: 'message', ellipsis: true },
                ]}
              />
            ),
          },
        ]}
        style={{ marginTop: 12 }}
      />

      <Modal
        title={detail?.game?.name ? `${detail.game.name} (${detail.game.appid})` : '游戏详情'}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={1080}
      >
        {detailLoading && <Typography.Text>加载中...</Typography.Text>}
        {!detailLoading && !detail && <Typography.Text type="secondary">暂无详情</Typography.Text>}
        {!detailLoading && detail && (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Card size="small" title="基础信息">
              <Descriptions bordered size="small" column={1}>
                <Descriptions.Item label="appid">{detail.game.appid}</Descriptions.Item>
                <Descriptions.Item label="name">{detail.game.name}</Descriptions.Item>
                <Descriptions.Item label="genres">{detail.game.genres.join(', ') || '—'}</Descriptions.Item>
                <Descriptions.Item label="categories">{detail.game.categories.join(', ') || '—'}</Descriptions.Item>
                <Descriptions.Item label="tags">{detail.game.tags?.join(', ') || '—'}</Descriptions.Item>
                <Descriptions.Item label="developers">{detail.game.developers?.join(', ') || '—'}</Descriptions.Item>
                <Descriptions.Item label="publishers">{detail.game.publishers?.join(', ') || '—'}</Descriptions.Item>
                <Descriptions.Item label="description">{detail.game.shortDescription || '—'}</Descriptions.Item>
                <Descriptions.Item label="discountPercent">{detail.game.discountPercent ?? 0}%</Descriptions.Item>
                <Descriptions.Item label="clickCount">{detail.game.clickCount ?? 0}</Descriptions.Item>
                <Descriptions.Item label="discountUrl">
                  <Space>
                    <Input
                      value={discountUrl}
                      onChange={(e) => setDiscountUrl(e.target.value)}
                      placeholder="https://..."
                      style={{ width: 420 }}
                    />
                    <Button
                      type="primary"
                      onClick={async () => {
                        try {
                          await adminApi.patchGame(detail.game.appid, { discountUrl: discountUrl.trim() });
                          message.success('折扣链接已保存');
                          await openDetail(detail.game.appid);
                        } catch (e) {
                          message.error(e instanceof Error ? e.message : '保存失败');
                        }
                      }}
                    >
                      保存折扣链接
                    </Button>
                  </Space>
                </Descriptions.Item>
                {detail.reviewSummary && (
                  <Descriptions.Item label="reviewSummary">
                    {detail.reviewSummary.reviewScoreDesc} · {detail.reviewSummary.positivePercent}% positive · total{' '}
                    {detail.reviewSummary.totalReviews}
                  </Descriptions.Item>
                )}
              </Descriptions>
            </Card>

            <Card size="small" title={`Deal Links (${detail.dealLinks?.length ?? 0})`}>
              <Space wrap style={{ marginBottom: 10 }}>
                <Select
                  value={dealDraft.source}
                  onChange={(v) => setDealDraft((p) => ({ ...p, source: v }))}
                  style={{ width: 130 }}
                  options={[
                    { value: 'manual', label: 'manual' },
                    { value: 'affiliate', label: 'affiliate' },
                    { value: 'steam', label: 'steam' },
                    { value: 'isthereanydeal', label: 'isthereanydeal' },
                    { value: 'ggdeals', label: 'gg.deals' },
                    { value: 'cheapshark', label: 'cheapshark' },
                    { value: 'fanatical', label: 'fanatical' },
                    { value: 'cdkeys', label: 'cdkeys' },
                    { value: 'gearup', label: 'gearup' },
                  ]}
                />
                <Input
                  value={dealDraft.url}
                  onChange={(e) => setDealDraft((p) => ({ ...p, url: e.target.value }))}
                  placeholder="https://deal-link..."
                  style={{ width: 380 }}
                />
                <InputNumber
                  min={0}
                  max={9999}
                  value={dealDraft.priority}
                  onChange={(v) => setDealDraft((p) => ({ ...p, priority: Number(v || 100) }))}
                />
                <Input
                  placeholder="startAt ISO(optional)"
                  style={{ width: 200 }}
                  value={dealDraft.startAt ?? ''}
                  onChange={(e) => setDealDraft((p) => ({ ...p, startAt: e.target.value }))}
                />
                <Input
                  placeholder="endAt ISO(optional)"
                  style={{ width: 200 }}
                  value={dealDraft.endAt ?? ''}
                  onChange={(e) => setDealDraft((p) => ({ ...p, endAt: e.target.value }))}
                />
                <span>affiliate</span>
                <Switch checked={dealDraft.isAffiliate} onChange={(v) => setDealDraft((p) => ({ ...p, isAffiliate: v }))} />
                <span>active</span>
                <Switch checked={dealDraft.isActive} onChange={(v) => setDealDraft((p) => ({ ...p, isActive: v }))} />
                <Button
                  onClick={async () => {
                    try {
                      const out = await adminApi.syncGameDeals(detail.game.appid);
                      message.success(`实时折扣同步完成：${out.upserted}`);
                      await openDetail(detail.game.appid);
                      void load();
                    } catch (e) {
                      message.error(e instanceof Error ? e.message : '折扣同步失败');
                    }
                  }}
                >
                  实时获取折扣
                </Button>
                <Button
                  type="primary"
                  onClick={async () => {
                    try {
                      await adminApi.createGameDealLink(detail.game.appid, dealDraft);
                      message.success('Deal link 已保存');
                      await openDetail(detail.game.appid);
                    } catch (e) {
                      message.error(e instanceof Error ? e.message : '保存deal link失败');
                    }
                  }}
                >
                  添加 Deal Link
                </Button>
              </Space>
              {detail.bestDeal && (
                <Typography.Paragraph type="secondary">
                  当前 best_deal: [{detail.bestDeal.source}] {detail.bestDeal.url}
                </Typography.Paragraph>
              )}
              <Table
                rowKey="dealId"
                size="small"
                pagination={false}
                dataSource={detail.dealLinks ?? []}
                columns={[
                  { title: 'source', dataIndex: 'source', width: 100 },
                  { title: 'cc', dataIndex: 'countryCode', width: 70 },
                  { title: 'url', dataIndex: 'url', ellipsis: true },
                  { title: 'orig', dataIndex: 'originalPrice', width: 90, render: (v?: number) => (typeof v === 'number' ? v : '-') },
                  { title: 'final', dataIndex: 'finalPrice', width: 90, render: (v?: number) => (typeof v === 'number' ? v : '-') },
                  { title: 'disc%', dataIndex: 'discountPercent', width: 90, render: (v?: number) => (typeof v === 'number' ? `${v}%` : '-') },
                  { title: 'hot', dataIndex: 'hotnessScore', width: 90, render: (v?: number | null) => (typeof v === 'number' ? v : '-') },
                  { title: 'affiliate', dataIndex: 'isAffiliate', width: 90, render: (v: boolean) => (v ? 'yes' : 'no') },
                  { title: 'active', dataIndex: 'isActive', width: 80, render: (v: boolean) => (v ? 'yes' : 'no') },
                  { title: 'priority', dataIndex: 'priority', width: 90 },
                  {
                    title: 'op',
                    width: 210,
                    render: (_, r: DealLinkRow) => (
                      <Space>
                        <Button
                          size="small"
                          onClick={async () => {
                            try {
                              await adminApi.patchGameDealLink(detail.game.appid, r.dealId, {
                                source: r.source,
                                url: r.url,
                                isAffiliate: r.isAffiliate,
                                isActive: !r.isActive,
                                priority: r.priority,
                                startAt: r.startAt,
                                endAt: r.endAt,
                              });
                              message.success('状态已更新');
                              await openDetail(detail.game.appid);
                            } catch (e) {
                              message.error(e instanceof Error ? e.message : '更新失败');
                            }
                          }}
                        >
                          {r.isActive ? '停用' : '启用'}
                        </Button>
                        <Button
                          size="small"
                          onClick={async () => {
                            try {
                              await adminApi.patchGameDealLink(detail.game.appid, r.dealId, {
                                source: r.source,
                                url: r.url,
                                isAffiliate: r.isAffiliate,
                                isActive: r.isActive,
                                priority: Math.max(0, r.priority - 10),
                                startAt: r.startAt,
                                endAt: r.endAt,
                              });
                              message.success('优先级已提升');
                              await openDetail(detail.game.appid);
                            } catch (e) {
                              message.error(e instanceof Error ? e.message : '更新失败');
                            }
                          }}
                        >
                          提升优先级
                        </Button>
                      </Space>
                    ),
                  },
                ]}
              />
            </Card>

            <Card size="small" title={`同步资源（固定值）`}>
              <Space wrap>
                <Button
                  onClick={async () => {
                    try {
                      await adminApi.syncGameDetail(detail.game.appid);
                      message.success('已同步详情到服务器');
                      await openDetail(detail.game.appid);
                    } catch (e) {
                      message.error(e instanceof Error ? e.message : '同步失败');
                    }
                  }}
                >
                  同步图片/视频
                </Button>
                <InputNumber min={1} max={200} value={reviewsPages} onChange={(v) => setReviewsPages(Number(v || 20))} />
                <Button
                  type="primary"
                  onClick={async () => {
                    try {
                      const out = await adminApi.loadGameReviews(detail.game.appid, { maxPages: reviewsPages });
                      message.success(`评论手动加载完成：${out.reviewCount}`);
                      await openDetail(detail.game.appid);
                    } catch (e) {
                      message.error(e instanceof Error ? e.message : '评论加载失败');
                    }
                  }}
                >
                  手动加载评论
                </Button>
              </Space>
            </Card>

            <Card size="small" title={`关联视频 (${detail.videos.length})`}>
              <Table
                size="small"
                rowKey="videoId"
                pagination={{ pageSize: 6 }}
                dataSource={detail.videos}
                columns={[
                  { title: 'videoId', dataIndex: 'videoId', width: 140, ellipsis: true },
                  { title: 'title', dataIndex: 'title', ellipsis: true },
                  { title: 'status', dataIndex: 'status', width: 100, render: (v: string) => <Tag>{v}</Tag> },
                  {
                    title: 'op',
                    width: 90,
                    render: (_, r) => <Link to={`/videos/${r.videoId}`}>详情</Link>,
                  },
                ]}
              />
            </Card>

            {detail.game.screenshots?.length > 0 && (
              <Card size="small" title={`截图 (${detail.game.screenshots.length})`}>
                <Space wrap>
                  {detail.game.screenshots.slice(0, 20).map((u) => (
                    <Image key={u} src={u} width={140} />
                  ))}
                </Space>
              </Card>
            )}

            {detail.game.trailerUrls?.length > 0 && (
              <Card size="small" title={`视频链接 (${detail.game.trailerUrls.length})`}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  {detail.game.trailerUrls.map((u) => (
                    <a key={u} href={u} target="_blank" rel="noreferrer">
                      {u}
                    </a>
                  ))}
                </Space>
              </Card>
            )}

            <Card size="small" title={`评论 (${detail.reviews.length})`}>
              <Table
                size="small"
                rowKey={(r) => `${r.reviewId}_${r.timestampCreated}`}
                pagination={{ pageSize: 8 }}
                dataSource={detail.reviews}
                columns={[
                  { title: 'time', dataIndex: 'timestampCreated', width: 160, render: (v: number) => new Date(v * 1000).toISOString() },
                  { title: 'author', dataIndex: 'authorSteamId', width: 150, ellipsis: true },
                  { title: 'lang', dataIndex: 'language', width: 80 },
                  { title: 'votes', dataIndex: 'votesUp', width: 80 },
                  { title: 'votedUp', dataIndex: 'votedUp', width: 90, render: (v: boolean) => (v ? 'yes' : 'no') },
                  { title: 'content', dataIndex: 'content', ellipsis: true },
                ]}
              />
            </Card>
          </Space>
        )}
      </Modal>
    </div>
  );
}

