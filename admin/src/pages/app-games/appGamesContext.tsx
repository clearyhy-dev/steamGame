import { message } from 'antd';
import { createContext, useCallback, useContext, useEffect, useRef, useMemo, useState, type ReactNode } from 'react';
import { adminApi } from '../../api/admin';
import type { DealLinkRow, GameDetailResponse, GameManageRow, SteamSyncJobRow } from '../../types';

type DiscountSource = 'all' | 'steam' | 'isthereanydeal' | 'ggdeals' | 'cheapshark';

const DEAL_SYNC_HINT_KEY = 'steamgame.admin.lastDealSyncHint';

/** 供子页面（如 `GamesDataPage`）引用 */
export type AppGamesWorkspaceValue = {
  rows: GameManageRow[];
  total: number;
  loading: boolean;
  page: number;
  pageSize: number;
  setPage: (p: number) => void;
  setPageSize: (s: number) => void;
  appid: string;
  setAppid: (s: string) => void;
  keyword: string;
  setKeyword: (s: string) => void;
  minDiscountPercent: number;
  setMinDiscountPercent: (n: number) => void;
  discountSource: DiscountSource;
  setDiscountSource: (v: DiscountSource) => void;
  discountCountry: string;
  setDiscountCountry: (s: string) => void;
  hotnessMin: number;
  setHotnessMin: (n: number) => void;
  hasDiscountInfo: 'all' | 'yes' | 'no';
  setHasDiscountInfo: (v: 'all' | 'yes' | 'no') => void;
  hasDealLink: 'all' | 'yes' | 'no';
  setHasDealLink: (v: 'all' | 'yes' | 'no') => void;
  hasDetailSynced: 'all' | 'yes' | 'no';
  setHasDetailSynced: (v: 'all' | 'yes' | 'no') => void;
  priceSynced: 'all' | 'today' | 'yes' | 'no';
  setPriceSynced: (v: 'all' | 'today' | 'yes' | 'no') => void;
  querySeq: number;
  runQuery: () => void;
  load: () => Promise<void>;
  detailOpen: boolean;
  setDetailOpen: (v: boolean) => void;
  detailLoading: boolean;
  detail: GameDetailResponse | null;
  dealDraft: {
    source: DealLinkRow['source'];
    url: string;
    isAffiliate: boolean;
    isActive: boolean;
    priority: number;
    startAt?: string | null;
    endAt?: string | null;
  };
  setDealDraft: React.Dispatch<
    React.SetStateAction<{
      source: DealLinkRow['source'];
      url: string;
      isAffiliate: boolean;
      isActive: boolean;
      priority: number;
      startAt?: string | null;
      endAt?: string | null;
    }>
  >;
  reviewsPages: number;
  setReviewsPages: (n: number) => void;
  openDetail: (targetAppid: string) => Promise<void>;
  syncingBatch: boolean;
  setSyncingBatch: (v: boolean) => void;
  syncingDealsBatch: boolean;
  setSyncingDealsBatch: (v: boolean) => void;
  detailSyncOffset: number;
  setDetailSyncOffset: (n: number) => void;
  detailCursorAppid: string;
  setDetailCursorAppid: (s: string) => void;
  dealCursorAppid: string;
  setDealCursorAppid: (s: string) => void;
  detailSyncRows: Array<{
    appid: string;
    status: 'synced' | 'skipped' | 'failed';
    message?: string;
    name?: string;
    currentPlayers?: number;
    discountPercent?: number;
    priceFinal?: number;
  }>;
  setDetailSyncRows: React.Dispatch<
    React.SetStateAction<
      Array<{
        appid: string;
        status: 'synced' | 'skipped' | 'failed';
        message?: string;
        name?: string;
        currentPlayers?: number;
        discountPercent?: number;
        priceFinal?: number;
      }>
    >
  >;
  appListCursor: number;
  setAppListCursor: (n: number) => void;
  syncJobs: SteamSyncJobRow[];
  setSyncJobs: React.Dispatch<React.SetStateAction<SteamSyncJobRow[]>>;
  dealCoverage: Array<{ source: string; ok: number; empty: number; failed: number }>;
  setDealCoverage: React.Dispatch<React.SetStateAction<Array<{ source: string; ok: number; empty: number; failed: number }>>>;
  dealBatchRows: Array<{
    appid: string;
    name?: string;
    ok: boolean;
    upserted: number;
    inserted?: number;
    updated?: number;
    deduped?: number;
    message?: string;
  }>;
  setDealBatchRows: React.Dispatch<
    React.SetStateAction<
      Array<{
        appid: string;
        name?: string;
        ok: boolean;
        upserted: number;
        inserted?: number;
        updated?: number;
        deduped?: number;
        message?: string;
      }>
    >
  >;
  dealBatchMeta: {
    cursorStart?: string | null;
    cursorEnd?: string | null;
    requestedBatchSize?: number;
    staleMarked?: number;
    staleScanned?: number;
  };
  setDealBatchMeta: React.Dispatch<
    React.SetStateAction<{
      cursorStart?: string | null;
      cursorEnd?: string | null;
      requestedBatchSize?: number;
      staleMarked?: number;
      staleScanned?: number;
    }>
  >;
  syncDealsBySources: (
    sources: Array<'steam' | 'isthereanydeal' | 'ggdeals' | 'cheapshark'>,
    opts?: { pageAppids?: string[] },
  ) => Promise<void>;
  /** 最近一次本机折扣批量完成提示（localStorage，刷新后仍在） */
  lastDealSyncHint: string | null;
  /** 全渠道批量（不传 sources，与「折扣同步」页「批量获取折扣(100)」一致） */
  runDealSyncFullBatch: () => Promise<void>;
  /** 使用当前 cursor 再跑一批（nextCursor 为空时保留原 cursor） */
  runDealSyncContinueBatch: () => Promise<void>;
  /** 按热度 TopN 更新折扣 */
  runDealSyncHotTop: () => Promise<void>;
  /** 与 `game_discount_offers` 分桶国对齐的业务国（传给 `insight_country`） */
  insightCountry: string;
  setInsightCountry: (s: string) => void;
  /** Country/Steam 页已启用国家，供分桶国下拉 */
  regionCountryOptions: Array<{ value: string; label: string }>;
  regionCountriesReady: boolean;
  /** GG 发现：现价接近接口返回史低（全库扫描） */
  ggDiscoverNearHistorical: boolean;
  setGgDiscoverNearHistorical: (v: boolean) => void;
  ggDiscoveryScan: boolean;
};

const Ctx = createContext<AppGamesWorkspaceValue | null>(null);

export function useAppGamesWorkspace(): AppGamesWorkspaceValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAppGamesWorkspace must be used under AppGamesWorkspaceProvider');
  return v;
}

export function AppGamesWorkspaceProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<GameManageRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [appid, setAppid] = useState('');
  const [keyword, setKeyword] = useState('');
  const [minDiscountPercent, setMinDiscountPercent] = useState<number>(0);
  const [discountSource, setDiscountSource] = useState<DiscountSource>('all');
  const [discountCountry, setDiscountCountry] = useState('');
  const [hotnessMin, setHotnessMin] = useState<number>(0);
  const [hasDiscountInfo, setHasDiscountInfo] = useState<'all' | 'yes' | 'no'>('all');
  const [hasDealLink, setHasDealLink] = useState<'all' | 'yes' | 'no'>('all');
  const [hasDetailSynced, setHasDetailSynced] = useState<'all' | 'yes' | 'no'>('all');
  const [priceSynced, setPriceSynced] = useState<'all' | 'today' | 'yes' | 'no'>('all');
  const [querySeq, setQuerySeq] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<GameDetailResponse | null>(null);
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
  const [lastDealSyncHint, setLastDealSyncHint] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DEAL_SYNC_HINT_KEY);
    } catch {
      return null;
    }
  });
  const [detailSyncRows, setDetailSyncRows] = useState<
    Array<{
      appid: string;
      status: 'synced' | 'skipped' | 'failed';
      message?: string;
      name?: string;
      currentPlayers?: number;
      discountPercent?: number;
      priceFinal?: number;
    }>
  >([]);
  const [appListCursor, setAppListCursor] = useState(0);
  const [syncJobs, setSyncJobs] = useState<SteamSyncJobRow[]>([]);
  const [dealCoverage, setDealCoverage] = useState<Array<{ source: string; ok: number; empty: number; failed: number }>>([]);
  const [dealBatchRows, setDealBatchRows] = useState<
    Array<{
      appid: string;
      name?: string;
      ok: boolean;
      upserted: number;
      inserted?: number;
      updated?: number;
      deduped?: number;
      message?: string;
    }>
  >([]);
  const [dealBatchMeta, setDealBatchMeta] = useState<{
    cursorStart?: string | null;
    cursorEnd?: string | null;
    requestedBatchSize?: number;
    staleMarked?: number;
    staleScanned?: number;
  }>({});
  const [insightCountry, setInsightCountry] = useState('US');
  const [regionCountryOptions, setRegionCountryOptions] = useState<Array<{ value: string; label: string }>>([]);
  const [regionCountriesReady, setRegionCountriesReady] = useState(false);
  const [ggDiscoverNearHistorical, setGgDiscoverNearHistorical] = useState(false);
  const [ggDiscoveryScan, setGgDiscoveryScan] = useState(false);

  const listSnap = useRef({
    appid,
    keyword,
    minDiscountPercent,
    hasDealLink,
    hasDetailSynced,
    priceSynced,
    discountSource,
    discountCountry,
    hasDiscountInfo,
    hotnessMin,
    page,
    pageSize,
    insightCountry,
    ggDiscoverNearHistorical,
  });
  listSnap.current = {
    appid,
    keyword,
    minDiscountPercent,
    hasDealLink,
    hasDetailSynced,
    priceSynced,
    discountSource,
    discountCountry,
    hasDiscountInfo,
    hotnessMin,
    page,
    pageSize,
    insightCountry,
    ggDiscoverNearHistorical,
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = (await adminApi.regionCountriesList()) as Array<{
          countryCode: string;
          countryName?: string;
          enabled?: boolean;
          sortOrder?: number;
        }>;
        if (cancelled) return;
        let enabled = list.filter((r) => r.enabled === true);
        if (enabled.length === 0) {
          enabled = list.slice().sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0));
        }
        enabled.sort((a, b) => (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0) || a.countryCode.localeCompare(b.countryCode));
        const opts = enabled
          .map((r) => {
            const code = String(r.countryCode ?? '')
              .trim()
              .toUpperCase()
              .slice(0, 2);
            if (!/^[A-Z]{2}$/.test(code)) return null;
            return { value: code, label: `${code} · ${r.countryName ?? code}` };
          })
          .filter((x): x is { value: string; label: string } => x != null);
        setRegionCountryOptions(opts);
      } catch {
        if (!cancelled) {
          message.warning('国家配置加载失败，分桶国暂仅 US；可在 Country/Steam 页检查');
          setRegionCountryOptions([{ value: 'US', label: 'US' }]);
        }
      } finally {
        if (!cancelled) setRegionCountriesReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!regionCountriesReady || regionCountryOptions.length === 0) return;
    const codes = new Set(regionCountryOptions.map((o) => o.value));
    if (!codes.has(insightCountry)) {
      const fallback = codes.has('US') ? 'US' : regionCountryOptions[0]!.value;
      setInsightCountry(fallback);
    }
  }, [regionCountriesReady, regionCountryOptions, insightCountry]);

  const load = useCallback(async () => {
    const s = listSnap.current;
    setLoading(true);
    try {
      const out = await adminApi.games({
        appid: s.appid.trim() || undefined,
        keyword: s.keyword.trim() || undefined,
        discount_percent: s.minDiscountPercent || undefined,
        has_deal_link: s.hasDealLink === 'all' ? undefined : s.hasDealLink === 'yes',
        has_detail_synced: s.hasDetailSynced === 'all' ? undefined : s.hasDetailSynced === 'yes',
        price_synced: s.priceSynced === 'all' ? undefined : s.priceSynced,
        discount_source: s.discountSource === 'all' ? undefined : s.discountSource,
        discount_country: s.discountCountry.trim() || undefined,
        has_discount_info: s.hasDiscountInfo === 'all' ? undefined : s.hasDiscountInfo === 'yes',
        hotness_min: s.hotnessMin || undefined,
        page: s.page,
        pageSize: s.pageSize,
        sortBy: 'online_desc',
        insight_country: /^[A-Z]{2}$/.test(s.insightCountry.trim()) ? s.insightCountry.trim().toUpperCase() : undefined,
        ...(s.ggDiscoverNearHistorical ? { gg_near_historical: 1 } : {}),
      });
      setRows(out.rows);
      setTotal(out.total);
      setGgDiscoveryScan(!!out.ggDiscoveryScan);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 筛选条件在点击「查询」时通过 runQuery 递增 querySeq；insightCountry 变更需即时刷新分桶列
  }, [
    querySeq,
    page,
    pageSize,
    insightCountry,
    ggDiscoverNearHistorical,
    load,
  ]);

  const runQuery = useCallback(() => {
    setPage(1);
    setQuerySeq((v) => v + 1);
  }, []);

  const recordDealSyncHint = useCallback((label: string, total: number) => {
    const text = `${new Date().toLocaleString()} · ${label} · ${total} 款`;
    try {
      localStorage.setItem(DEAL_SYNC_HINT_KEY, text);
    } catch {
      /* ignore */
    }
    setLastDealSyncHint(text);
  }, []);

  const syncDealsBySources = useCallback(
    async (sources: Array<'steam' | 'isthereanydeal' | 'ggdeals' | 'cheapshark'>, opts?: { pageAppids?: string[] }) => {
      const explicitPage = opts?.pageAppids !== undefined;
      const pageIds = (opts?.pageAppids ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
      if (explicitPage && pageIds.length === 0) {
        message.warning('当前列表为空，无法同步本页');
        return;
      }
      const pageMode = explicitPage;
      setSyncingDealsBatch(true);
      try {
        const out = await adminApi.syncGameDealsBatch({
          batchSize: pageMode ? Math.min(1000, pageIds.length) : 100,
          delayMs: 80,
          cursorAppid: pageMode ? undefined : dealCursorAppid || undefined,
          appids: pageMode ? pageIds : undefined,
          sources,
        });
        if (!pageMode) {
          setDealCursorAppid(out.nextCursorAppid ?? '');
        }
        setDealCoverage(out.coverage ?? []);
        setDealBatchRows(out.rows ?? []);
        setDealBatchMeta({
          cursorStart: out.cursorStart,
          cursorEnd: out.cursorEnd,
          requestedBatchSize: out.requestedBatchSize,
          staleMarked: out.staleMarked,
          staleScanned: out.staleScanned,
        });
        const scope = pageMode ? '本页' : '游标批量';
        message.success(`${scope} · ${sources.join(',')} · 成功${out.success}, 失败${out.failed}`);
        recordDealSyncHint(`${scope} ${sources.join('+')}`, out.total ?? out.rows?.length ?? 0);
        setQuerySeq((v) => v + 1);
      } catch (e) {
        message.error(e instanceof Error ? e.message : '按平台批量折扣同步失败');
      } finally {
        setSyncingDealsBatch(false);
      }
    },
    [dealCursorAppid, recordDealSyncHint],
  );

  const runDealSyncFullBatch = useCallback(async () => {
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
      recordDealSyncHint('全渠道(游标)', out.total ?? out.rows?.length ?? 0);
      setQuerySeq((v) => v + 1);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '批量折扣同步失败');
    } finally {
      setSyncingDealsBatch(false);
    }
  }, [dealCursorAppid, recordDealSyncHint]);

  const runDealSyncContinueBatch = useCallback(async () => {
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
      recordDealSyncHint('继续游标', out.total ?? out.rows?.length ?? 0);
      setQuerySeq((v) => v + 1);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '继续折扣同步失败');
    } finally {
      setSyncingDealsBatch(false);
    }
  }, [dealCursorAppid, recordDealSyncHint]);

  const runDealSyncHotTop = useCallback(async () => {
    setSyncingDealsBatch(true);
    try {
      const out = await adminApi.syncGameDealsHotTop({ topN: 1000, delayMs: 80, staleTtlHours: 6 });
      setDealCoverage(out.coverage ?? []);
      setDealBatchRows(out.rows ?? []);
      setDealBatchMeta({
        cursorStart: out.cursorStart,
        cursorEnd: out.cursorEnd,
        requestedBatchSize: out.requestedBatchSize,
        staleMarked: out.staleMarked,
        staleScanned: out.staleScanned,
      });
      message.success(`热度Top1000更新完成: 成功${out.success}, 失败${out.failed}`);
      recordDealSyncHint('热度Top1000', out.total ?? out.rows?.length ?? 0);
      setQuerySeq((v) => v + 1);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '热度Top更新失败');
    } finally {
      setSyncingDealsBatch(false);
    }
  }, [recordDealSyncHint]);

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

  const openDetail = useCallback(async (targetAppid: string) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const out = await adminApi.gameDetail(targetAppid, { allReviews: true });
      setDetail(out);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载详情失败');
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  const value = useMemo<AppGamesWorkspaceValue>(
    () => ({
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
      querySeq,
      runQuery,
      load,
      detailOpen,
      setDetailOpen,
      detailLoading,
      detail,
      dealDraft,
      setDealDraft,
      reviewsPages,
      setReviewsPages,
      openDetail,
      syncingBatch,
      setSyncingBatch,
      syncingDealsBatch,
      setSyncingDealsBatch,
      detailSyncOffset,
      setDetailSyncOffset,
      detailCursorAppid,
      setDetailCursorAppid,
      dealCursorAppid,
      setDealCursorAppid,
      detailSyncRows,
      setDetailSyncRows,
      appListCursor,
      setAppListCursor,
      syncJobs,
      setSyncJobs,
      dealCoverage,
      setDealCoverage,
      dealBatchRows,
      setDealBatchRows,
      dealBatchMeta,
      setDealBatchMeta,
      syncDealsBySources,
      lastDealSyncHint,
      runDealSyncFullBatch,
      runDealSyncContinueBatch,
      runDealSyncHotTop,
      insightCountry,
      setInsightCountry,
      regionCountryOptions,
      regionCountriesReady,
      ggDiscoverNearHistorical,
      setGgDiscoverNearHistorical,
      ggDiscoveryScan,
    }),
    [
      rows,
      total,
      loading,
      page,
      pageSize,
      appid,
      keyword,
      minDiscountPercent,
      discountSource,
      discountCountry,
      hotnessMin,
      hasDiscountInfo,
      hasDealLink,
      hasDetailSynced,
      querySeq,
      runQuery,
      load,
      detailOpen,
      detailLoading,
      detail,
      dealDraft,
      reviewsPages,
      openDetail,
      syncingBatch,
      syncingDealsBatch,
      detailSyncOffset,
      detailCursorAppid,
      dealCursorAppid,
      detailSyncRows,
      appListCursor,
      syncJobs,
      dealCoverage,
      dealBatchRows,
      dealBatchMeta,
      syncDealsBySources,
      lastDealSyncHint,
      runDealSyncFullBatch,
      runDealSyncContinueBatch,
      runDealSyncHotTop,
      insightCountry,
      regionCountryOptions,
      regionCountriesReady,
      ggDiscoverNearHistorical,
      ggDiscoveryScan,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
