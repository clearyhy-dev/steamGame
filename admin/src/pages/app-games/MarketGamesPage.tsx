import { Alert, Button, Card, Descriptions, Drawer, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../api/admin';
import type {
  MarketGameDetailResponse,
  MarketGameRow,
  MarketPlatformPriceCell,
  MarketSyncGlobalState,
} from '../../types';
import { effectiveCurrencySymbol } from '../../utils/currencySymbol';
import { discountTag, formatPlatformAmount, formatPriceRange } from '../../utils/marketPriceDisplay';
import { useAppGamesWorkspace } from './appGamesContext';

const MARKET_COUNTRY_KEY = 'steamgame.admin.marketCountry';

function ExtLink({ href, children }: { href?: string | null; children?: string }) {
  if (!href) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children ?? '链接'}
    </a>
  );
}

function fmtMs(ms: number | null): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

function platformCellEmpty(cell: MarketPlatformPriceCell | null | undefined): boolean {
  return !cell || (cell.finalPrice == null && cell.originalPrice == null);
}

function platformColumn(
  key: keyof NonNullable<MarketGameRow['priceSummary']>['platforms'],
  label: string,
  tagColor: string,
  emptyHint = '暂无',
): ColumnsType<MarketGameRow>[number] {
  return {
    title: label,
    key,
    width: 168,
    render: (_, r) => {
      const cell = r.priceSummary?.platforms?.[key];
      if (platformCellEmpty(cell)) {
        return <Typography.Text type="secondary">{emptyHint}</Typography.Text>;
      }
      const cellSym = cell!.currency ? effectiveCurrencySymbol(cell!.currency) : '';
      return (
        <Space direction="vertical" size={0}>
          <Tag color={tagColor}>{label}</Tag>
          <Typography.Text style={{ fontSize: 12 }}>
            {formatPriceRange(cell, cellSym || undefined)}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 11 }}>
            {discountTag(cell!.discountPercent)}
            {cell!.currency ? ` · ${cell!.currency}` : ''}
          </Typography.Text>
          {cell!.url ? <ExtLink href={cell!.url}>购买</ExtLink> : null}
        </Space>
      );
    },
  };
}

function PlatformPriceTable({ cell, label }: { cell: MarketPlatformPriceCell; label: string }) {
  const cellSym = cell.currency ? effectiveCurrencySymbol(cell.currency) : '';
  if (platformCellEmpty(cell)) {
    return (
      <tr>
        <td style={{ padding: '6px 8px', fontWeight: 500 }}>{label}</td>
        <td colSpan={5} style={{ padding: '6px 8px' }}>
          <Typography.Text type="secondary">暂无</Typography.Text>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td style={{ padding: '6px 8px', fontWeight: 500 }}>{label}</td>
      <td style={{ padding: '6px 8px' }}>{formatPlatformAmount(cell.originalPrice, cell.currency, cellSym || undefined)}</td>
      <td style={{ padding: '6px 8px' }}>{formatPlatformAmount(cell.finalPrice, cell.currency, cellSym || undefined)}</td>
      <td style={{ padding: '6px 8px' }}>{discountTag(cell.discountPercent)}</td>
      <td style={{ padding: '6px 8px' }}>{cell.currency ?? '—'}</td>
      <td style={{ padding: '6px 8px' }}>
        <ExtLink href={cell.url}>购买</ExtLink>
      </td>
    </tr>
  );
}

export function MarketGamesPage() {
  const { insightCountry, setInsightCountry, regionCountryOptions, regionCountriesReady } = useAppGamesWorkspace();
  const [rows, setRows] = useState<MarketGameRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<'online_desc' | 'heat_desc' | 'discount_desc'>('heat_desc');
  const [currency, setCurrency] = useState('');
  const [gameCount, setGameCount] = useState<number | null>(null);
  const [syncState, setSyncState] = useState<MarketSyncGlobalState | null>(null);
  const [runningRr, setRunningRr] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailAppid, setDetailAppid] = useState('');
  const [detail, setDetail] = useState<MarketGameDetailResponse | null>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MARKET_COUNTRY_KEY);
      if (saved && /^[A-Z]{2}$/.test(saved)) setInsightCountry(saved);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- init once
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(MARKET_COUNTRY_KEY, insightCountry);
    } catch {
      /* ignore */
    }
  }, [insightCountry]);

  const loadSyncStatus = useCallback(async () => {
    try {
      const out = await adminApi.marketsSyncStatus();
      setSyncState(out.state);
    } catch {
      setSyncState(null);
    }
  }, []);

  const load = useCallback(async () => {
    const cc = insightCountry.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return;
    setLoading(true);
    try {
      const [list, stats] = await Promise.all([
        adminApi.marketsList(cc, { page, pageSize, sortBy }),
        adminApi.marketsStats(cc),
      ]);
      setRows(list.rows);
      setTotal(list.total);
      setCurrency(list.currency);
      setGameCount(stats.gameCount);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载市场数据失败');
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [insightCountry, page, pageSize, sortBy]);

  useEffect(() => {
    if (!regionCountriesReady) return;
    void load();
    void loadSyncStatus();
  }, [load, loadSyncStatus, regionCountriesReady]);

  const openDetail = async (appid: string) => {
    setDetailAppid(appid);
    setDrawerOpen(true);
    setDetailLoading(true);
    try {
      const out = await adminApi.marketsGameDetail(insightCountry, appid);
      setDetail(out);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载详情失败');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const columns: ColumnsType<MarketGameRow> = [
    { title: 'AppID', dataIndex: 'appid', width: 88, fixed: 'left' },
    { title: '名称', dataIndex: 'name', width: 180, ellipsis: true, fixed: 'left' },
    {
      title: '在线',
      dataIndex: 'currentPlayers',
      width: 80,
      render: (v: number) => v?.toLocaleString() ?? '0',
    },
    {
      title: 'Steam 原价',
      key: 'steamOrig',
      width: 110,
      render: (_, r) => {
        const p = r.priceSummary?.platforms.steam ?? {
          originalPrice: r.originalPrice,
          finalPrice: r.finalPrice,
          discountPercent: r.discountPercent,
          currency: r.currency,
          url: r.priceSummary?.steamStoreUrl ?? null,
        };
        const cur = p.currency ?? currency;
        const cellSym = cur ? effectiveCurrencySymbol(cur) : '';
        return formatPlatformAmount(p.originalPrice, cur, cellSym || undefined);
      },
    },
    {
      title: 'Steam 现价',
      key: 'steamFin',
      width: 110,
      render: (_, r) => {
        const p = r.priceSummary?.platforms.steam;
        const fin = p?.finalPrice ?? r.finalPrice;
        const cur = p?.currency ?? currency;
        const cellSym = cur ? effectiveCurrencySymbol(cur) : '';
        return formatPlatformAmount(fin, cur, cellSym || undefined);
      },
    },
    {
      title: 'Steam%',
      key: 'steamDisc',
      width: 72,
      render: (_, r) => {
        const v = r.priceSummary?.platforms.steam.discountPercent ?? r.discountPercent;
        return v > 0 ? <Tag color="red">-{v}%</Tag> : '—';
      },
    },
    {
      title: 'Steam',
      key: 'steamLink',
      width: 72,
      render: (_, r) => (
        <ExtLink href={r.priceSummary?.steamStoreUrl ?? r.priceSummary?.platforms.steam.url}>商店</ExtLink>
      ),
    },
    platformColumn('isthereanydeal', 'ITAD', 'purple'),
    platformColumn('ggdeals', 'GG', 'cyan', '该地区暂无'),
    platformColumn('cheapshark', 'CS', 'geekblue'),
    { title: '热度', dataIndex: 'heatScore', width: 80, render: (v: number) => Math.round(v).toLocaleString() },
    {
      title: '价格同步',
      dataIndex: 'priceSyncedAtMs',
      width: 150,
      render: (v: number | null) => fmtMs(v),
    },
    {
      title: '操作',
      width: 72,
      fixed: 'right',
      render: (_, r) => (
        <Button type="link" size="small" onClick={() => void openDetail(r.appid)}>
          详情
        </Button>
      ),
    },
  ];

  const summary = detail?.priceSummary;

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        分国市场 v2
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        Steam 原价/现价 + ITAD / GG.deals / CheapShark 分国折扣价、购买链接与折扣比例。各列展示平台 API 返回的原生货币，不做汇率换算。
        数据来自 <Typography.Text code>prices.json</Typography.Text> 四平台同步；无价格摘要的行需重新跑轮询或单游戏同步。
      </Typography.Paragraph>

      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 12 }}
        message="分平台货币说明"
        description={
          <>
            请勿直接比较不同列的数字大小。Steam 在部分国家（如阿根廷 AR）可能返回 USD 而非当地货币；ITAD / GG / CheapShark
            各自按请求国家返回对应货币。GG.deals 未覆盖的地区显示「该地区暂无」，不再静默回退美国价。
          </>
        }
      />

      {syncState ? (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="轮询状态"
          description={
            <>
              当前国 <Tag>{syncState.currentCountryCode ?? '—'}</Tag>
              队列 {syncState.countryQueue.join(' → ') || '—'}
              {syncState.appidCursor ? (
                <>
                  {' '}
                  · 游标 <Typography.Text code>{syncState.appidCursor}</Typography.Text>
                </>
              ) : null}
              {syncState.lastRunSummary ? <> · {syncState.lastRunSummary}</> : null}
            </>
          }
        />
      ) : null}

      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap>
          <span>锁定国家</span>
          <Select
            style={{ width: 200 }}
            value={insightCountry}
            loading={!regionCountriesReady}
            options={regionCountryOptions}
            onChange={(v) => {
              setInsightCountry(v);
              setPage(1);
            }}
          />
          {currency ? (
            <Tag color="blue">
              地区参考货币 {currency}
            </Tag>
          ) : null}
          {gameCount != null ? <Tag>已入库 {gameCount} 款</Tag> : null}
          <span>排序</span>
          <Select
            style={{ width: 140 }}
            value={sortBy}
            onChange={(v) => {
              setSortBy(v);
              setPage(1);
            }}
            options={[
              { value: 'heat_desc', label: '热度降序' },
              { value: 'online_desc', label: '在线降序' },
              { value: 'discount_desc', label: '折扣降序' },
            ]}
          />
          <Button onClick={() => void load()} loading={loading}>
            刷新
          </Button>
          <Button
            type="primary"
            loading={runningRr}
            onClick={async () => {
              setRunningRr(true);
              try {
                const out = await adminApi.marketsRunRoundRobin({});
                message.success(out.summary, 6);
                await loadSyncStatus();
                await load();
              } catch (e) {
                message.error(e instanceof Error ? e.message : '轮询失败');
              } finally {
                setRunningRr(false);
              }
            }}
          >
            立即跑一轮轮询
          </Button>
        </Space>
      </Card>

      <Table
        rowKey="appid"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={rows}
        scroll={{ x: 1600 }}
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

      <Drawer
        title={`${insightCountry} · App ${detailAppid}${detail?.index?.name ? ` · ${detail.index.name}` : ''}`}
        width={760}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        loading={detailLoading}
      >
        {summary ? (
          <>
            <Typography.Title level={5}>分平台价格（{insightCountry}）</Typography.Title>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16, fontSize: 13 }}>
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>平台</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>原价</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>现价</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>折扣</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>货币</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>链接</th>
                </tr>
              </thead>
              <tbody>
                <PlatformPriceTable cell={summary.platforms.steam} label="Steam" />
                <PlatformPriceTable cell={summary.platforms.isthereanydeal} label="ITAD" />
                <PlatformPriceTable cell={summary.platforms.ggdeals} label="GG.deals" />
                <PlatformPriceTable cell={summary.platforms.cheapshark} label="CheapShark" />
              </tbody>
            </table>
            {summary.steamStoreUrl ? (
              <Typography.Paragraph>
                Steam 商店：<ExtLink href={summary.steamStoreUrl}>{summary.steamStoreUrl}</ExtLink>
              </Typography.Paragraph>
            ) : null}
          </>
        ) : (
          <Alert type="warning" showIcon message="暂无价格摘要" description="请对该游戏执行轮询同步或单游戏刷新。" style={{ marginBottom: 16 }} />
        )}

        {detail?.detail ? (
          <>
            <Typography.Title level={5}>Steam 详情</Typography.Title>
            <Descriptions column={1} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="名称">{String((detail.detail as Record<string, unknown>).name ?? '')}</Descriptions.Item>
              <Descriptions.Item label="开发商">
                {Array.isArray((detail.detail as Record<string, unknown>).developers)
                  ? ((detail.detail as Record<string, unknown>).developers as string[]).join(', ')
                  : '—'}
              </Descriptions.Item>
              <Descriptions.Item label="简介">
                <Typography.Paragraph ellipsis={{ rows: 4, expandable: true }} style={{ margin: 0 }}>
                  {String((detail.detail as Record<string, unknown>).shortDescription ?? '')}
                </Typography.Paragraph>
              </Descriptions.Item>
            </Descriptions>
          </>
        ) : null}

        {detail?.heat ? (
          <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
            <Descriptions.Item label="在线">{String((detail.heat as Record<string, unknown>).currentPlayers ?? '—')}</Descriptions.Item>
            <Descriptions.Item label="热度分">{String((detail.heat as Record<string, unknown>).heatScore ?? '—')}</Descriptions.Item>
          </Descriptions>
        ) : null}
      </Drawer>
    </div>
  );
}
