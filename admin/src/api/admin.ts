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
  RegionSettings,
  RuntimeEffectiveSettings,
  RuntimeSettingsResponse,
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
  getDiscountProvidersSettings: () =>
    unwrap(api.get<ApiEnvelope<DiscountProvidersSettings>>('/api/admin/settings/discount-providers')),
  patchDiscountProvidersSettings: (body: Partial<DiscountProvidersSettings>) =>
    unwrap(api.patch<ApiEnvelope<DiscountProvidersSettings>>('/api/admin/settings/discount-providers', body)),

  getRuntimeSettings: () => unwrap(api.get<ApiEnvelope<RuntimeSettingsResponse>>('/api/admin/settings/runtime')),
  patchRuntimeSettings: (body: Partial<RuntimeEffectiveSettings> & { steamAutoSyncEnabled?: boolean }) =>
    unwrap(api.patch<ApiEnvelope<RuntimeSettingsResponse>>('/api/admin/settings/runtime', body)),
  getRegionSettings: () => unwrap(api.get<ApiEnvelope<RegionSettings>>('/api/admin/settings/region-settings')),
  patchRegionSettings: (body: Partial<RegionSettings>) =>
    unwrap(api.patch<ApiEnvelope<RegionSettings>>('/api/admin/settings/region-settings', body)),

  regionCountriesList: () =>
    unwrap(api.get<ApiEnvelope<Record<string, unknown>[]>>(`/api/admin/region-countries`)),
  regionCountriesUpsert: (body: Record<string, unknown>) =>
    unwrap(api.post<ApiEnvelope<Record<string, unknown>>>(`/api/admin/region-countries`, body)),
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
    has_detail_synced?: boolean;
    page?: number;
    pageSize?: number;
    sortBy?: 'online_desc' | 'updated_desc' | 'discount_desc';
    discount_source?: 'steam' | 'isthereanydeal' | 'ggdeals' | 'cheapshark';
    discount_country?: string;
    has_discount_info?: boolean;
    hotness_min?: number;
  }) =>
    unwrap(api.get<ApiEnvelope<{ total: number; page: number; pageSize: number; rows: GameManageRow[] }>>('/api/admin/games', { params })),

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

  gameSyncJobs: (params?: { limit?: number }) =>
    unwrap(api.get<ApiEnvelope<{ rows: SteamSyncJobRow[] }>>('/api/admin/games/sync-jobs', { params })),

  gameDetail: (appid: string, params?: { allReviews?: boolean }) =>
    unwrap(api.get<ApiEnvelope<GameDetailResponse>>(`/api/admin/games/${appid}`, { params })),

  syncGameMeta: (appid: string) =>
    unwrap(api.post<ApiEnvelope<{ synced: boolean; appid: string }>>(`/api/admin/games/${appid}/sync-meta`)),

  loadGameReviews: (appid: string, params?: { maxPages?: number }) =>
    unwrap(
      api.post<ApiEnvelope<{ loaded: boolean; appid: string; reviewCount: number }>>(
        `/api/admin/games/${appid}/load-reviews`,
        undefined,
        { params },
      ),
    ),

  patchGame: (appid: string, body: { discountUrl: string }) =>
    unwrap(api.patch<ApiEnvelope<{ appid: string; discountUrl: string }>>(`/api/admin/games/${appid}`, body)),

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
};
