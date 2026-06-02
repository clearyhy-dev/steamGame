import axios from 'axios';
import { api, type ApiEnvelope } from './client';
import type {
  AdminUserRow,
  DashboardStats,
  DealLinkRow,
  GameDetailResponse,
  GameManageRow,
  SteamGameRow,
  VideoJobRow,
  VideoRow,
  VideoSourceRow,
  SteamSyncJobRow,
  DiscountProvidersSettings,
  RuntimeEffectiveSettings,
  RuntimeSettingsResponse,
  InfrastructureConfigResponse,
  InfrastructureMinioBrowseResponse,
  InfrastructureRedisBrowseResponse,
  AdminRequestLogRow,
  MetaEndpointsResponse,
  ScheduledTaskConfigRow,
  ScheduledTasksConfigResponse,
  MarketGameRow,
  MarketGamesListResponse,
  MarketGameDetailResponse,
  MarketSyncGlobalState,
  SqliteDbInfo,
  SqliteColumnMeta,
  SqliteTableMeta,
  SqliteRowsResponse,
} from '../types';

async function unwrap<T>(p: Promise<{ data: ApiEnvelope<T> }>): Promise<T> {
  try {
    const { data } = await p;
    if (!data.ok) throw new Error(data.message ?? 'Request failed');
    return data.data as T;
  } catch (e: unknown) {
    if (axios.isAxiosError(e)) {
      const body = e.response?.data as ApiEnvelope<unknown> | undefined;
      if (body?.message) throw new Error(body.message);
      if (typeof e.response?.data === 'object' && e.response?.data && 'error' in e.response.data) {
        const er = (e.response.data as { error?: { message?: string } }).error;
        if (er?.message) throw new Error(er.message);
      }
    }
    throw e instanceof Error ? e : new Error(String(e));
  }
}

export const adminApi = {
  login: (username: string, password: string) =>
    unwrap(api.post<ApiEnvelope<{ token: string; username: string }>>('/api/admin/auth/login', { username, password })),

  me: () => unwrap(api.get<ApiEnvelope<{ username: string }>>('/api/admin/auth/me')),

  logout: () => unwrap(api.post<ApiEnvelope<Record<string, never>>>('/api/admin/auth/logout')),

  dashboardStats: () => unwrap(api.get<ApiEnvelope<DashboardStats>>('/api/admin/dashboard/stats')),
  requestLogs: (params?: {
    userId?: string;
    pathPrefix?: string;
    method?: string;
    statusCode?: number;
    fromMs?: number;
    toMs?: number;
    limit?: number;
  }) => unwrap(api.get<ApiEnvelope<{ total: number; rows: AdminRequestLogRow[] }>>('/api/admin/request-logs', { params })),

  /** Read-only diagnostics for troubleshooting. */
  metaEndpoints: () =>
    unwrap(api.get<ApiEnvelope<MetaEndpointsResponse>>('/api/admin/meta/endpoints')),
  getDiscountProvidersSettings: () =>
    unwrap(api.get<ApiEnvelope<DiscountProvidersSettings>>('/api/admin/settings/discount-providers')),
  patchDiscountProvidersSettings: (body: Partial<DiscountProvidersSettings>) =>
    unwrap(api.patch<ApiEnvelope<DiscountProvidersSettings>>('/api/admin/settings/discount-providers', body)),

  getRuntimeSettings: () => unwrap(api.get<ApiEnvelope<RuntimeSettingsResponse>>('/api/admin/settings/runtime')),
  patchRuntimeSettings: (body: Partial<RuntimeEffectiveSettings> & { steamAutoSyncEnabled?: boolean }) =>
    unwrap(api.patch<ApiEnvelope<RuntimeSettingsResponse>>('/api/admin/settings/runtime', body)),

  getInfrastructureConfig: () =>
    unwrap(api.get<ApiEnvelope<InfrastructureConfigResponse>>('/api/admin/settings/infrastructure')),
  browseInfrastructureMinio: (params?: { prefix?: string; limit?: number }) =>
    unwrap(
      api.get<ApiEnvelope<InfrastructureMinioBrowseResponse>>('/api/admin/settings/infrastructure/minio/objects', {
        params,
      }),
    ),
  browseInfrastructureRedis: () =>
    unwrap(api.get<ApiEnvelope<InfrastructureRedisBrowseResponse>>('/api/admin/settings/infrastructure/redis')),

  getScheduledTasks: () => unwrap(api.get<ApiEnvelope<ScheduledTasksConfigResponse>>('/api/admin/scheduled-tasks')),
  putScheduledTasks: (body: { tasks: ScheduledTaskConfigRow[] }) =>
    unwrap(api.put<ApiEnvelope<ScheduledTasksConfigResponse>>('/api/admin/scheduled-tasks', body)),
  /** 默认后台异步执行（避免代理/浏览器断开）；需同步等待时传 sync: true */
  runScheduledTaskNow: (taskId: string, opts?: { sync?: boolean }) =>
    unwrap(
      api.post<ApiEnvelope<{ task: ScheduledTaskConfigRow; async?: boolean }>>(
        `/api/admin/scheduled-tasks/${encodeURIComponent(taskId)}/run`,
        { sync: opts?.sync === true },
        { timeout: opts?.sync ? 3_600_000 : 120_000 },
      ),
    ),
  runAllScheduledTasksEnabled: (opts?: { sync?: boolean }) =>
    unwrap(
      api.post<
        ApiEnvelope<{
          async?: boolean;
          message?: string;
          results?: Array<{ id: string; taskKey: string; ok: boolean; summary?: string; error?: string; skipped?: boolean }>;
          tasks?: ScheduledTaskConfigRow[];
          updatedAt?: string;
        }>
      >('/api/admin/scheduled-tasks/run-all-enabled', { sync: opts?.sync === true }, { timeout: opts?.sync ? 3_600_000 : 120_000 }),
    ),

  sqliteInfo: () => unwrap(api.get<ApiEnvelope<SqliteDbInfo>>('/api/admin/sqlite/info')),
  sqliteTables: () => unwrap(api.get<ApiEnvelope<{ tables: SqliteTableMeta[] }>>('/api/admin/sqlite/tables')),
  sqliteTableSchema: (table: string) =>
    unwrap(api.get<ApiEnvelope<{ table: string; columns: SqliteColumnMeta[] }>>(`/api/admin/sqlite/tables/${encodeURIComponent(table)}/schema`)),
  sqliteTableRows: (table: string, params?: Record<string, string | number>) =>
    unwrap(
      api.get<ApiEnvelope<SqliteRowsResponse>>(`/api/admin/sqlite/tables/${encodeURIComponent(table)}/rows`, {
        params,
      }),
    ),
  dedupeTrailerVideos: (body?: { limit?: number }) =>
    unwrap(
      api.post<ApiEnvelope<{ gamesScanned: number; duplicatesRemoved: number }>>(
        '/api/admin/games/dedupe-trailer-videos',
        body ?? {},
        { timeout: 600_000 },
      ),
    ),

  sqliteUpdateRow: (table: string, body: { primaryKey: Record<string, unknown>; patch: Record<string, unknown> }) =>
    unwrap(
      api.patch<ApiEnvelope<{ changes: number }>>(`/api/admin/sqlite/tables/${encodeURIComponent(table)}/rows`, body),
    ),

  regionCountriesProviderMeta: () =>
    unwrap(
      api.get<
        ApiEnvelope<{
          ggDealsSuggestedRegions: string[];
          cheapsharkListCountry: string;
          cheapsharkNote: string;
        }>
      >(`/api/admin/region-countries/provider-meta`),
    ),
  regionCountriesList: () =>
    unwrap(api.get<ApiEnvelope<Record<string, unknown>[]>>(`/api/admin/region-countries`)),
  regionCountriesUpsert: (body: Record<string, unknown>) =>
    unwrap(api.post<ApiEnvelope<Record<string, unknown>>>(`/api/admin/region-countries`, body)),
  regionCountriesSyncProviderCodes: (force?: boolean) =>
    unwrap(
      api.post<ApiEnvelope<{ updated: number; force: boolean }>>(`/api/admin/region-countries/sync-provider-codes`, {
        force: !!force,
      }),
    ),
  regionCountriesSetEnabled: (countryCode: string, enabled: boolean) =>
    unwrap(
      api.patch<ApiEnvelope<{ countryCode: string; enabled: boolean }>>(
        `/api/admin/region-countries/${encodeURIComponent(countryCode)}/enabled`,
        { enabled },
      ),
    ),

  videoSources: (params?: { sourceType?: string; gameId?: string }) =>
    unwrap(api.get<ApiEnvelope<VideoSourceRow[]>>('/api/admin/video-sources', { params })),

  createYoutubeSource: (body: Record<string, unknown>) =>
    unwrap(api.post<ApiEnvelope<{ sourceId: string }>>('/api/admin/video-sources/youtube', body)),

  createSteamSource: (body: Record<string, unknown>) =>
    unwrap(api.post<ApiEnvelope<{ sourceId: string }>>('/api/admin/video-sources/steam', body)),

  patchSource: (sourceId: string, body: Record<string, unknown>) =>
    unwrap(api.patch<ApiEnvelope<{ sourceId: string }>>(`/api/admin/video-sources/${sourceId}`, body)),

  ingestSource: (sourceId: string) =>
    unwrap(api.post<ApiEnvelope<{ videoId: string; jobId?: string }>>(`/api/admin/video-sources/${sourceId}/ingest`)),

  getSource: (sourceId: string) => unwrap(api.get<ApiEnvelope<VideoSourceRow>>(`/api/admin/video-sources/${sourceId}`)),

  videos: (params?: { status?: string; visibility?: string; gameId?: string }) =>
    unwrap(api.get<ApiEnvelope<VideoRow[]>>('/api/admin/videos', { params })),

  videoDetail: (videoId: string) =>
    unwrap(
      api.get<ApiEnvelope<{ video: VideoRow; source: VideoSourceRow | null }>>(`/api/admin/videos/${videoId}`),
    ),

  publish: (videoId: string) =>
    unwrap(api.post<ApiEnvelope<{ videoId: string }>>(`/api/admin/videos/${videoId}/publish`)),

  unpublish: (videoId: string) =>
    unwrap(api.post<ApiEnvelope<{ videoId: string }>>(`/api/admin/videos/${videoId}/unpublish`)),

  reprocess: (videoId: string) =>
    unwrap(api.post<ApiEnvelope<{ jobId: string }>>(`/api/admin/videos/${videoId}/reprocess`)),

  jobs: (params?: { status?: string }) =>
    unwrap(api.get<ApiEnvelope<VideoJobRow[]>>('/api/admin/video-jobs', { params })),

  retryJob: (jobId: string) =>
    unwrap(api.post<ApiEnvelope<{ jobId: string }>>(`/api/admin/video-jobs/${jobId}/retry`)),

  steamGames: (params?: {
    source?: 'all' | 'owned' | 'recent';
    steamId?: string;
    appid?: string;
    keyword?: string;
    ownerLimit?: number;
    rowLimit?: number;
  }) =>
    unwrap(api.get<ApiEnvelope<{ total: number; rows: SteamGameRow[] }>>('/api/admin/steam-games', { params })),

  syncSteamUser: (steamId: string) =>
    unwrap(
      api.post<ApiEnvelope<{ synced: boolean; steamId: string; friendsCount: number; ownedGameCount: number; recentTotalCount: number }>>(
        `/api/admin/steam-users/${steamId}/sync`,
      ),
    ),

  users: (params?: { provider?: 'google' | 'steam'; keyword?: string }) =>
    unwrap(api.get<ApiEnvelope<AdminUserRow[]>>('/api/admin/users', { params })),

  patchUser: (userId: string, body: Record<string, unknown>) =>
    unwrap(api.patch<ApiEnvelope<{ userId: string }>>(`/api/admin/users/${userId}`, body)),

  games: (params?: {
    keyword?: string;
    appid?: string;
    discount_percent?: number;
    has_deal_link?: boolean;
    /** today=今日已同步 | yes=有过价格同步 | no=未同步 */
    price_synced?: 'today' | 'yes' | 'no';
    has_detail_synced?: boolean;
    page?: number;
    pageSize?: number;
    sortBy?: 'online_desc' | 'updated_desc' | 'discount_desc';
    discount_source?: 'steam' | 'isthereanydeal' | 'ggdeals' | 'cheapshark';
    discount_country?: string;
    has_discount_info?: boolean;
    hotness_min?: number;
    /** 返回该业务国分桶洞察（史低、链接、值得买等，数据来自 game_discount_offers） */
    insight_country?: string;
    gg_near_historical?: 1;
  }) =>
    unwrap(
      api.get<
        ApiEnvelope<{ total: number; page: number; pageSize: number; rows: GameManageRow[]; ggDiscoveryScan?: boolean }>
      >('/api/admin/games', { params }),
    ),

  syncAppList: (body?: { chunkSize?: number; lastAppId?: number; maxResults?: number }) =>
    unwrap(
      api.post<ApiEnvelope<{ totalFromSteam: number; uniqueCount: number; processed: number; inserted: number; updated: number; skipped: number; nextLastAppId: number; hasMore: boolean }>>(
        '/api/admin/games/sync-app-list',
        body ?? {},
      ),
    ),

  syncGameDetail: (appid: string) =>
    unwrap(api.post<ApiEnvelope<{ synced: boolean; appid: string }>>(`/api/admin/games/${appid}/sync-detail`)),
  syncGameDeals: (appid: string, body?: { countries?: string[]; sources?: Array<'steam' | 'isthereanydeal' | 'ggdeals' | 'cheapshark'> }) =>
    unwrap(api.post<ApiEnvelope<{ appid: string; upserted: number; writeStats?: { inserted: number; updated: number; deduped: number }; providers?: Array<{ source: string; ok: boolean; reason?: string }> }>>(`/api/admin/games/${appid}/sync-deals`, body ?? {})),
  syncGameDealsBatch: (body?: { appids?: string[]; batchSize?: number; delayMs?: number; cursorAppid?: string; countries?: string[]; sources?: Array<'steam' | 'isthereanydeal' | 'ggdeals' | 'cheapshark'> }) =>
    unwrap(
      api.post<ApiEnvelope<{ total: number; success: number; failed: number; nextCursorAppid?: string; hasMore?: boolean; cursorStart?: string | null; cursorEnd?: string | null; requestedBatchSize?: number; staleMarked?: number; staleScanned?: number; coverage?: Array<{ source: string; ok: number; empty: number; failed: number }>; rows: Array<{ appid: string; name?: string; ok: boolean; upserted: number; inserted?: number; updated?: number; deduped?: number; message?: string }> }>>(
        '/api/admin/games/sync-deals-batch',
        body ?? {},
      ),
    ),
  syncGameDealsHotTop: (body?: { topN?: number; delayMs?: number; sources?: Array<'steam' | 'isthereanydeal' | 'ggdeals' | 'cheapshark'>; staleTtlHours?: number }) =>
    unwrap(
      api.post<ApiEnvelope<{ total: number; success: number; failed: number; nextCursorAppid?: string; hasMore?: boolean; cursorStart?: string | null; cursorEnd?: string | null; requestedBatchSize?: number; staleMarked?: number; staleScanned?: number; coverage?: Array<{ source: string; ok: number; empty: number; failed: number }>; rows: Array<{ appid: string; name?: string; ok: boolean; upserted: number; inserted?: number; updated?: number; deduped?: number; message?: string }> }>>(
        '/api/admin/games/sync-deals-hot-top',
        body ?? {},
      ),
    ),

  syncGameDetailsBatch: (body?: { appids?: string[]; batchSize?: number; delayMs?: number; offset?: number; cursorAppid?: string; concurrency?: number; force?: boolean }) =>
    unwrap(
      api.post<ApiEnvelope<{ total: number; success: number; skipped: number; failed: number; nextOffset: number; nextCursorAppid?: string; hasMore?: boolean; reachedEnd?: boolean; rows: Array<{ appid: string; ok: boolean; status: 'synced' | 'skipped' | 'failed'; message?: string; name?: string; currentPlayers?: number; discountPercent?: number; priceFinal?: number }> }>>(
        '/api/admin/games/sync-details',
        body ?? {},
      ),
    ),

  /** 热度 Top500：Steam 在线人数 + 详情 + 每款最新 50 条评论（耗时长） */
  syncTopHeatPipeline: (body?: {
    topN?: number;
    delayMs?: number;
    maxReviews?: number;
    refreshPlayers?: boolean;
    syncDetails?: boolean;
    syncReviews?: boolean;
    forcePlayers?: boolean;
  }) =>
    unwrap(
      api.post<
        ApiEnvelope<{
          mode: string;
          topN: number;
          playersRefreshed: number;
          playersFailed: number;
          detailsSynced: number;
          detailsFailed: number;
          detailsSkipped: number;
          reviewsLoaded: number;
          reviewsFailed: number;
          reviewsSkipped: number;
        }>
      >('/api/admin/games/sync-top-heat-pipeline', body ?? {}, { timeout: 3_600_000 }),
    ),

  syncWeeklyHeatPage: (body?: { cursorAppid?: string; pageSize?: number; delayMs?: number; force?: boolean }) =>
    unwrap(
      api.post<
        ApiEnvelope<{
          mode: string;
          scanned: number;
          refreshed: number;
          skippedFresh: number;
          failed: number;
          nextCursorAppid: string | null;
          hasMore: boolean;
        }>
      >('/api/admin/games/sync-weekly-heat', body ?? {}, { timeout: 3_600_000 }),
    ),

  gameSyncJobs: (params?: { limit?: number }) =>
    unwrap(api.get<ApiEnvelope<{ rows: SteamSyncJobRow[] }>>('/api/admin/games/sync-jobs', { params })),

  gameDetail: (appid: string, params?: { allReviews?: boolean }) =>
    unwrap(api.get<ApiEnvelope<GameDetailResponse>>(`/api/admin/games/${appid}`, { params })),

  syncGameMeta: (appid: string) =>
    unwrap(api.post<ApiEnvelope<{ synced: boolean; appid: string }>>(`/api/admin/games/${appid}/sync-meta`)),

  loadGameReviews: (appid: string, params?: { maxReviews?: number }) =>
    unwrap(
      api.post<ApiEnvelope<{ loaded: boolean; appid: string; reviewCount: number; maxReviews?: number }>>(
        `/api/admin/games/${appid}/load-reviews`,
        undefined,
        { params },
      ),
    ),


  gameDealLinks: (appid: string) =>
    unwrap(api.get<ApiEnvelope<{ rows: DealLinkRow[] }>>(`/api/admin/games/${appid}/deal-links`)),

  createGameDealLink: (
    appid: string,
    body: { source: string; url: string; isAffiliate?: boolean; isActive?: boolean; priority?: number; startAt?: string | null; endAt?: string | null },
  ) =>
    unwrap(api.post<ApiEnvelope<{ deal: DealLinkRow }>>(`/api/admin/games/${appid}/deal-links`, body)),

  patchGameDealLink: (
    appid: string,
    dealId: string,
    body: { source: string; url: string; isAffiliate?: boolean; isActive?: boolean; priority?: number; startAt?: string | null; endAt?: string | null },
  ) =>
    unwrap(api.patch<ApiEnvelope<{ deal: DealLinkRow }>>(`/api/admin/games/${appid}/deal-links/${dealId}`, body)),

  marketsList: (cc: string, params?: { page?: number; pageSize?: number; sortBy?: string }) =>
    unwrap(api.get<ApiEnvelope<MarketGamesListResponse>>(`/api/admin/markets/${cc}/games`, { params })),

  marketsStats: (cc: string) =>
    unwrap(api.get<ApiEnvelope<{ countryCode: string; gameCount: number; currency: string; currencySymbol: string }>>(
      `/api/admin/markets/${cc}/stats`,
    )),

  marketsSyncStatus: () =>
    unwrap(api.get<ApiEnvelope<{ state: MarketSyncGlobalState | null }>>('/api/admin/markets/sync-status')),

  marketsGameDetail: (cc: string, appid: string) =>
    unwrap(api.get<ApiEnvelope<MarketGameDetailResponse>>(`/api/admin/markets/${cc}/games/${appid}`)),

  marketsSyncOne: (cc: string, appid: string, body?: { forceRefresh?: boolean }) =>
    unwrap(
      api.post<
        ApiEnvelope<{
          appid: string;
          ok: boolean;
          detailOk: boolean;
          heatOk: boolean;
          pricesOk: boolean;
          skipped?: boolean;
          message?: string;
        }>
      >(`/api/admin/markets/${cc}/games/${appid}/sync`, body ?? {}, { timeout: 600_000 }),
    ),

  marketsRunRoundRobin: (payload?: Record<string, unknown>) =>
    unwrap(
      api.post<
        ApiEnvelope<{
          countryCode: string;
          currency: string;
          currencySymbol: string;
          processed: number;
          success: number;
          failed: number;
          skipped: number;
          summary: string;
        }>
      >('/api/admin/markets/round-robin/run', { payload: payload ?? {} }, { timeout: 3_600_000 }),
    ),
};
