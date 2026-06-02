import { Alert, Button, Checkbox, Image, Input, InputNumber, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { adminApi } from '../../api/admin';
import type { GameManageRow } from '../../types';
import type { AppGamesWorkspaceValue } from './appGamesContext';
import { useAppGamesWorkspace } from './appGamesContext';
import { GameNameCell, NAME_COL_WIDTH } from './GameNameCell';

export type GamesDataVariant = 'steam' | 'itad' | 'gg' | 'cheapshark' | 'worthbuy';

function ExtLink({ href, children }: { href?: string | null; children?: string }) {
  if (!href) return <Typography.Text type="secondary">—</Typography.Text>;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {children ?? '打开'}
    </a>
  );
}

function VariantDealSyncBar({
  variant,
  syncing,
  syncDealsBySources,
  runFull,
  runContinue,
  runHotTop,
  lastSyncHint,
  pageAppids,
}: {
  variant: GamesDataVariant;
  syncing: boolean;
  syncDealsBySources: (
    s: Array<'steam' | 'isthereanydeal' | 'ggdeals' | 'cheapshark'>,
    opts?: { pageAppids?: string[] },
  ) => void;
  runFull: () => void;
  runContinue: () => void;
  runHotTop: () => void;
  lastSyncHint?: string | null;
  pageAppids: string[];
}) {
  const commonContinue = (
    <Button loading={syncing} onClick={() => void runContinue()}>
      继续下一批折扣
    </Button>
  );

  const pageBar = (
    <>
      {lastSyncHint ? (
        <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
          最近批量：{lastSyncHint}
        </Typography.Text>
      ) : null}
    </>
  );

  if (variant === 'steam') {
    return (
      <Space wrap style={{ marginBottom: 12 }} direction="vertical" size={0}>
        {pageBar}
        <Space wrap>
        <Typography.Text type="secondary">本页折扣同步（仅当前表格行）</Typography.Text>
        <Button loading={syncing} type="primary" onClick={() => void syncDealsBySources(['steam'], { pageAppids })}>
          Steam 折扣批量
        </Button>
        <Button loading={syncing} onClick={() => void runFull()}>
          全渠道批量(100)
        </Button>
        {commonContinue}
        </Space>
      </Space>
    );
  }
  if (variant === 'itad') {
    return (
      <Space wrap style={{ marginBottom: 12 }} direction="vertical" size={0}>
        {pageBar}
        <Space wrap>
        <Typography.Text type="secondary">本页折扣同步（仅当前表格行）</Typography.Text>
        <Button loading={syncing} type="primary" onClick={() => void syncDealsBySources(['isthereanydeal'], { pageAppids })}>
          ITAD 折扣批量
        </Button>
        {commonContinue}
        </Space>
      </Space>
    );
  }
  if (variant === 'gg') {
    return (
      <Space wrap style={{ marginBottom: 12 }} direction="vertical" size={0}>
        {pageBar}
        <Space wrap>
        <Typography.Text type="secondary">本页折扣同步（仅当前表格行）</Typography.Text>
        <Button loading={syncing} type="primary" onClick={() => void syncDealsBySources(['ggdeals'], { pageAppids })}>
          GG 折扣批量
        </Button>
        {commonContinue}
        </Space>
      </Space>
    );
  }
  if (variant === 'cheapshark') {
    return (
      <Space wrap style={{ marginBottom: 12 }} direction="vertical" size={0}>
        {pageBar}
        <Space wrap>
        <Typography.Text type="secondary">本页折扣同步（仅当前表格行）</Typography.Text>
        <Button loading={syncing} type="primary" onClick={() => void syncDealsBySources(['cheapshark'], { pageAppids })}>
          CheapShark 折扣批量
        </Button>
        {commonContinue}
        </Space>
      </Space>
    );
  }
  return (
    <Space wrap style={{ marginBottom: 12 }} direction="vertical" size={0}>
      {pageBar}
      <Space wrap>
      <Typography.Text type="secondary">本页折扣同步</Typography.Text>
      <Button loading={syncing} type="primary" onClick={() => void runHotTop()}>
        热度 Top1000 更新
      </Button>
      <Button loading={syncing} onClick={() => void runFull()}>
        全渠道批量(100)
      </Button>
      {commonContinue}
      </Space>
    </Space>
  );
}

const TITLES: Record<GamesDataVariant, { title: string; desc: string }> = {
  steam: {
    title: 'Steam 数据',
    desc: 'Steam 商店元数据 + 在线人数 + 主站折扣；购买链接取自分桶 Steam 或同国 deal。',
  },
  itad: {
    title: 'ITAD 价格分析',
    desc: '按分桶国请求 ITAD（与 Country 配置 itadCountry 一致）：现价/折扣写入 `game_discount_offers`；详情弹窗含 ITAD 历史价折线与周热度表中的按日在线人数折线。',
  },
  gg: {
    title: 'GG.deals 发现',
    desc: '按分桶国 region 调用 `v1/prices/by-steam-app-id`：现价/史低/货币写入 `ggDetail.prices`（官方字段），链接带 `region=`。热度类标签不在该接口。发现筛选「近 GG 史低」按接口返回的 current* 与 historical* 比较（全库扫描）。',
  },
  cheapshark: {
    title: 'CheapShark 补充价',
    desc: '快速参考价与跳转；与 ITAD 互补。',
  },
  worthbuy: {
    title: '值得买指数',
    desc: 'Score = 0.4D + 0.3R + 0.2P + 0.1T。T 待 GG 趋势接入后加强。',
  },
};

function opColumn(ws: AppGamesWorkspaceValue): ColumnsType<GameManageRow>[number] {
  const { openDetail, load } = ws;
  return {
    title: '操作',
    key: 'op',
    width: 200,
    render: (_, r) => (
      <Space wrap>
        <Button size="small" onClick={() => void openDetail(r.appid)}>
          详情
        </Button>
        <Button
          size="small"
          type="primary"
          onClick={async () => {
            try {
              await adminApi.createSteamSource({
                gameId: r.appid,
                steamAppId: r.appid,
                title: r.name || `Steam ${r.appid}`,
                ingestMode: 'process',
                priority: 0,
              });
              message.success('已加入视频来源');
            } catch (e) {
              message.error(e instanceof Error ? e.message : '失败');
            }
          }}
        >
          视频源
        </Button>
        <Button
          size="small"
          onClick={async () => {
            try {
              await adminApi.syncGameDetail(r.appid);
              message.success('已同步详情');
              await openDetail(r.appid);
              void load();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '失败');
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
              message.success(`折扣: ${out.upserted}`);
              await openDetail(r.appid);
              void load();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '失败');
            }
          }}
        >
          同步折扣
        </Button>
      </Space>
    ),
  };
}

export function GamesDataPage({ variant }: { variant: GamesDataVariant }) {
  const ws = useAppGamesWorkspace();
  const {
    rows,
    total,
    loading,
    page,
    pageSize,
    setPage,
    setPageSize,
    appid,
    setAppid,
    keyword,
    setKeyword,
    minDiscountPercent,
    setMinDiscountPercent,
    discountSource,
    setDiscountSource,
    discountCountry,
    setDiscountCountry,
    hotnessMin,
    setHotnessMin,
    hasDiscountInfo,
    setHasDiscountInfo,
    hasDealLink,
    setHasDealLink,
    hasDetailSynced,
    setHasDetailSynced,
    priceSynced,
    setPriceSynced,
    runQuery,
    load,
    openDetail,
    insightCountry,
    setInsightCountry,
    regionCountryOptions,
    regionCountriesReady,
    syncingDealsBatch,
    syncDealsBySources,
    runDealSyncFullBatch,
    runDealSyncContinueBatch,
    runDealSyncHotTop,
    lastDealSyncHint,
    ggDiscoverNearHistorical,
    setGgDiscoverNearHistorical,
    ggDiscoveryScan,
  } = ws;

  const baseCols: ColumnsType<GameManageRow> = [
    {
      title: '#',
      key: 'idx',
      width: 56,
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
    { title: 'online', dataIndex: 'currentPlayers', width: 88, render: (v?: number) => v ?? 0 },
  ];

  const steamCols: ColumnsType<GameManageRow> = [
    ...baseCols,
    { title: 'steam%', dataIndex: 'steamDiscountPercent', width: 86, render: (v?: number | null) => (typeof v === 'number' ? `${v}%` : '-') },
    { title: 'catalog%', dataIndex: 'discountPercent', width: 96, render: (v: number) => `${v ?? 0}%` },
    { title: 'hot(max)', dataIndex: 'maxHotnessScore', width: 100, render: (v?: number) => (typeof v === 'number' ? v : '-') },
    {
      title: 'Steam 商店',
      key: 'steamStore',
      width: 100,
      render: (_, r) => <ExtLink href={r.countryInsight?.steamStoreUrl}>商店</ExtLink>,
    },
    {
      title: 'Steam 购买',
      key: 'steamBuy',
      width: 100,
      render: (_, r) => <ExtLink href={r.countryInsight?.steamPurchaseUrl}>购买</ExtLink>,
    },
    {
      title: 'detail',
      dataIndex: 'detailSynced',
      width: 86,
      render: (v?: boolean) => (v ? <Tag color="blue">synced</Tag> : <Tag>no</Tag>),
    },
    { title: 'clicks', dataIndex: 'clickCount', width: 80 },
    { title: 'videos', dataIndex: 'linkedVideos', width: 80 },
    opColumn(ws),
  ];

  const itadCols: ColumnsType<GameManageRow> = [
    ...baseCols,
    { title: 'itad%', dataIndex: 'itadDiscountPercent', width: 72, render: (v?: number | null) => (typeof v === 'number' ? `${v}%` : '-') },
    {
      title: 'ITAD 现价',
      key: 'itadPx',
      width: 128,
      render: (_, r) => {
        const t = r.countryInsight?.itadCurrentPriceDisplay;
        if (!t) return '—';
        return (
          <Space direction="vertical" size={0}>
            <Tag color="purple">ITAD</Tag>
            <Typography.Text style={{ fontSize: 12 }}>{t}</Typography.Text>
          </Space>
        );
      },
    },
    {
      title: 'ITAD 国',
      key: 'itadC',
      width: 72,
      render: (_, r) => r.countryInsight?.itadApiCountry ?? r.countryInsight?.itadBucketCountry ?? '—',
    },
    {
      title: 'ITAD 链接',
      key: 'itadL',
      width: 88,
      render: (_, r) => <ExtLink href={r.countryInsight?.itadPurchaseUrl}>购买</ExtLink>,
    },
    { title: 'ITAD id', key: 'igid', width: 120, ellipsis: true, render: (_, r) => r.countryInsight?.itadGameId ?? '—' },
    { title: '史低(all)', key: 'hla', width: 100, render: (_, r) => r.countryInsight?.historyLowAll ?? '—' },
    { title: '史低(y1)', key: 'hly', width: 100, render: (_, r) => r.countryInsight?.historyLowY1 ?? '—' },
    { title: '史低(m3)', key: 'hlm', width: 100, render: (_, r) => r.countryInsight?.historyLowM3 ?? '—' },
    { title: 'bundles', key: 'bc', width: 72, render: (_, r) => r.countryInsight?.itadBundleCount ?? 0 },
    { title: '历史点', key: 'php', width: 80, render: (_, r) => r.countryInsight?.itadPriceHistoryPoints ?? 0 },
    {
      title: '近史低',
      key: 'near',
      width: 80,
      render: (_, r) => {
        const v = r.countryInsight?.nearHistoricalLow;
        if (v == null) return '—';
        return v ? <Tag color="green">是</Tag> : <Tag>否</Tag>;
      },
    },
    { title: 'waitlist', key: 'wl', width: 80, render: (_, r) => r.countryInsight?.itadWaitlisted ?? '—' },
    opColumn(ws),
  ];

  const ggCols: ColumnsType<GameManageRow> = [
    ...baseCols,
    { title: 'gg%', dataIndex: 'ggDealsDiscountPercent', width: 72, render: (v?: number | null) => (typeof v === 'number' ? `${v}%` : '-') },
    {
      title: 'GG 现价',
      key: 'ggPx',
      width: 118,
      render: (_, r) => {
        const t = r.countryInsight?.ggCurrentPriceDisplay;
        if (!t) return '—';
        return (
          <Space direction="vertical" size={0}>
            <Tag color="cyan">GG</Tag>
            <Typography.Text style={{ fontSize: 12 }}>{t}</Typography.Text>
          </Space>
        );
      },
    },
    { title: 'region', key: 'ggr', width: 64, render: (_, r) => r.countryInsight?.ggApiRegion ?? '—' },
    {
      title: 'GG 链接',
      key: 'ggL',
      width: 88,
      render: (_, r) => <ExtLink href={r.countryInsight?.ggDealsUrl}>打开</ExtLink>,
    },
    {
      title: '近GG史低',
      key: 'ggnh',
      width: 88,
      render: (_, r) => {
        const v = r.countryInsight?.ggNearHistoricalLow;
        if (v == null) return '—';
        return v ? <Tag color="green">是</Tag> : <Tag>否</Tag>;
      },
    },
    {
      title: 'GG 官价/史低',
      key: 'ggop',
      width: 200,
      render: (_, r) => {
        const p = r.countryInsight?.ggOfficialPrices;
        if (!p) return '—';
        const c = p.currency ?? '';
        const line = (a: string, cur?: number, hist?: number) =>
          `${a}: ${cur != null ? `${cur} ${c}`.trim() : '—'} / 史低 ${hist != null ? `${hist} ${c}`.trim() : '—'}`;
        return (
          <Typography.Text style={{ fontSize: 11, display: 'block', whiteSpace: 'pre-wrap' }}>
            {line('零售', p.currentRetail, p.historicalRetail)}
            {'\n'}
            {line('Keyshop', p.currentKeyshops, p.historicalKeyshops)}
          </Typography.Text>
        );
      },
    },
    { title: 'hot(max)', dataIndex: 'maxHotnessScore', width: 100, render: (v?: number) => (typeof v === 'number' ? v : '-') },
    { title: 'clicks', dataIndex: 'clickCount', width: 80 },
    opColumn(ws),
  ];

  const csCols: ColumnsType<GameManageRow> = [
    ...baseCols,
    {
      title: 'cheap%',
      dataIndex: 'cheapSharkDiscountPercent',
      width: 86,
      render: (v?: number | null) => (typeof v === 'number' ? `${v}%` : '-'),
    },
    {
      title: 'CheapShark',
      key: 'csL',
      width: 100,
      render: (_, r) => <ExtLink href={r.countryInsight?.cheapSharkUrl}>打开</ExtLink>,
    },
    { title: 'hot(max)', dataIndex: 'maxHotnessScore', width: 100, render: (v?: number) => (typeof v === 'number' ? v : '-') },
    opColumn(ws),
  ];

  const worthCols: ColumnsType<GameManageRow> = [
    ...baseCols,
    {
      title: 'Score',
      key: 'sc',
      width: 72,
      render: (_, r) => (r.countryInsight?.worthBuy?.score != null ? r.countryInsight.worthBuy.score.toFixed(3) : '—'),
    },
    { title: 'D', key: 'd', width: 56, render: (_, r) => r.countryInsight?.worthBuy?.D?.toFixed(2) ?? '—' },
    { title: 'R', key: 'rr', width: 56, render: (_, r) => r.countryInsight?.worthBuy?.R?.toFixed(2) ?? '—' },
    { title: 'P', key: 'p', width: 56, render: (_, r) => r.countryInsight?.worthBuy?.P?.toFixed(2) ?? '—' },
    { title: 'T', key: 't', width: 56, render: (_, r) => r.countryInsight?.worthBuy?.T?.toFixed(2) ?? '—' },
    {
      title: '近史低',
      key: 'near2',
      width: 80,
      render: (_, r) => {
        const v = r.countryInsight?.nearHistoricalLow;
        if (v == null) return '—';
        return v ? <Tag color="green">是</Tag> : <Tag>否</Tag>;
      },
    },
    opColumn(ws),
  ];

  const cols =
    variant === 'steam'
      ? steamCols
      : variant === 'itad'
        ? itadCols
        : variant === 'gg'
          ? ggCols
          : variant === 'cheapshark'
            ? csCols
            : worthCols;

  const meta = TITLES[variant];
  const noteRow = rows[0]?.countryInsight;

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        {meta.title}
      </Typography.Title>
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        {meta.desc}
      </Typography.Paragraph>
      {variant === 'gg' && noteRow?.ggDiscoveryNote && (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
          {noteRow.ggDiscoveryNote}
        </Typography.Paragraph>
      )}
      {variant === 'itad' && noteRow?.multiStoreExpansionNote && (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8, fontSize: 12 }}>
          {noteRow.multiStoreExpansionNote}
        </Typography.Paragraph>
      )}

      {variant === 'gg' && ggDiscoveryScan && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="当前为 GG 发现全库扫描"
          description="与「分桶国」及下方勾选条件组合，会遍历 game_catalog 再分页；库很大时较慢，适合发现系统预演。"
        />
      )}
      {variant === 'gg' && (
        <Space wrap align="center" style={{ marginBottom: 12 }}>
          <Typography.Text type="secondary">发现筛选（改勾选后自动查询）</Typography.Text>
          <Checkbox
            checked={ggDiscoverNearHistorical}
            onChange={(e) => {
              setGgDiscoverNearHistorical(e.target.checked);
              runQuery();
            }}
          >
            近 GG 史低（现价 ≤ 官渠史低 ×1.05 或 Keyshop 史低 ×1.05）
          </Checkbox>
        </Space>
      )}

      <Space wrap style={{ marginBottom: 16 }}>
        <Typography.Text type="secondary">分桶国</Typography.Text>
        <Select
          showSearch
          optionFilterProp="label"
          placeholder="选择国家"
          loading={!regionCountriesReady}
          disabled={regionCountryOptions.length === 0}
          value={regionCountryOptions.length ? insightCountry : undefined}
          onChange={(v) => setInsightCountry(v)}
          style={{ minWidth: 200 }}
          options={regionCountryOptions}
        />
        <Input placeholder="appid" value={appid} onChange={(e) => setAppid(e.target.value)} style={{ width: 120 }} />
        <Input placeholder="keyword" value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ width: 160 }} />
        <InputNumber min={0} max={100} value={minDiscountPercent} onChange={(v) => setMinDiscountPercent(Number(v || 0))} />
        <Select
          value={discountSource}
          onChange={(v) => setDiscountSource(v)}
          style={{ width: 140 }}
          options={[
            { label: 'src: all', value: 'all' },
            { label: 'steam', value: 'steam' },
            { label: 'itad', value: 'isthereanydeal' },
            { label: 'gg', value: 'ggdeals' },
            { label: 'cs', value: 'cheapshark' },
          ]}
        />
        <Input
          placeholder="filter deal 国"
          value={discountCountry}
          onChange={(e) => setDiscountCountry(e.target.value.toUpperCase())}
          style={{ width: 120 }}
        />
        <InputNumber min={0} max={999} value={hotnessMin} onChange={(v) => setHotnessMin(Number(v || 0))} />
        <Select
          value={hasDiscountInfo}
          onChange={(v) => setHasDiscountInfo(v)}
          style={{ width: 130 }}
          options={[
            { label: 'disc: all', value: 'all' },
            { label: 'disc: yes', value: 'yes' },
            { label: 'disc: no', value: 'no' },
          ]}
        />
        <Select
          value={hasDealLink}
          onChange={(v) => setHasDealLink(v)}
          style={{ width: 110 }}
          options={[
            { label: 'deal: all', value: 'all' },
            { label: 'deal: yes', value: 'yes' },
            { label: 'deal: no', value: 'no' },
          ]}
        />
        <Select
          value={priceSynced}
          onChange={(v) => setPriceSynced(v)}
          style={{ width: 150 }}
          options={[
            { label: '价格同步: 全部', value: 'all' },
            { label: '今日已同步', value: 'today' },
            { label: '曾同步过', value: 'yes' },
            { label: '未同步', value: 'no' },
          ]}
        />
        <Select
          value={hasDetailSynced}
          onChange={(v) => setHasDetailSynced(v)}
          style={{ width: 130 }}
          options={[
            { label: 'detail: all', value: 'all' },
            { label: 'synced', value: 'yes' },
            { label: 'unsynced', value: 'no' },
          ]}
        />
        <Button type="primary" onClick={runQuery}>
          查询
        </Button>
        <Button onClick={() => void load()}>刷新</Button>
      </Space>

      <VariantDealSyncBar
        variant={variant}
        syncing={syncingDealsBatch}
        syncDealsBySources={(s, o) => void syncDealsBySources(s, o)}
        runFull={() => void runDealSyncFullBatch()}
        runContinue={() => void runDealSyncContinueBatch()}
        runHotTop={() => void runDealSyncHotTop()}
        lastSyncHint={lastDealSyncHint}
        pageAppids={rows.map((r) => r.appid)}
      />

      <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
        共 {total} 条；分桶数据在 MinIO <Typography.Text code>cache/discount-offers/v1</Typography.Text>（或 Firestore）。
        「今日已同步」按 <Typography.Text strong>Asia/Shanghai</Typography.Text> 日历日判断；列表优先读 Redis 索引（
        <Typography.Text code>price-sync:日期:all</Typography.Text>），同步成功时自动写入，全库筛选后分页。
        与 <Typography.Text code>deal: yes</Typography.Text>（有链接）不同；指定 filter deal 国时只判断该国分桶的同步时间。
      </Typography.Paragraph>

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
    </div>
  );
}
