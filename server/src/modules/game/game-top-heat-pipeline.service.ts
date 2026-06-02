import type { Env } from '../../config/env';
import { logger } from '../../utils/logger';
import { SteamStoreService } from '../steam/steam-store.service';
import { GameCatalogRepository } from './game-catalog.repository';
import { GameWeeklyHeatRepository, isoWeekKeyUTC } from './game-weekly-heat.repository';
import { VideoRepository } from '../video/video.repository';
import { VideoSourceRepository } from '../video/video-source.repository';
import { upsertSteamTrailersAsVideos } from '../video/sync-steam-trailers-to-videos.service';
import { fetchSteamTrailerMp4 } from '../video/steam-trailer.util';
import { mergeTrailerClips, type SteamTrailerClip } from '../steam/steam-trailers.parse';
import type { SteamStoreGameDetail } from '../steam/steam-store.service';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type TopHeatPipelineResult = {
  topN: number;
  playersRefreshed: number;
  playersFailed: number;
  detailsSynced: number;
  detailsFailed: number;
  detailsSkipped: number;
  reviewsLoaded: number;
  reviewsFailed: number;
  reviewsSkipped: number;
};

function clipsFromDetail(detail: SteamStoreGameDetail): SteamTrailerClip[] {
  if (detail.trailerClips?.length) return [...detail.trailerClips];
  const urls = detail.trailerUrls ?? [];
  const thumbs = detail.trailerThumbnailUrls ?? [];
  return urls.map((url, i) => ({
    url,
    thumbnailUrl: thumbs[i] && /^https?:\/\//i.test(thumbs[i]!) ? thumbs[i] : undefined,
  }));
}

async function mergeTrailerClipsForApp(
  env: Env,
  appid: string,
  detail: SteamStoreGameDetail,
): Promise<SteamTrailerClip[]> {
  const clips: SteamTrailerClip[] = [...clipsFromDetail(detail)];
  try {
    const t = await fetchSteamTrailerMp4(env, appid);
    if (t.mp4Url) {
      const hit = clips.find((c) => c.url === t.mp4Url);
      if (hit) {
        if (t.thumbnailUrl && !hit.thumbnailUrl) hit.thumbnailUrl = t.thumbnailUrl;
      } else {
        clips.unshift({ url: t.mp4Url, thumbnailUrl: t.thumbnailUrl });
      }
    }
  } catch {
    /* optional */
  }
  return mergeTrailerClips(clips);
}

/**
 * Steam 热度 TopN：刷新当前在线人数 → 确保详情已同步 → 每款拉取最新评论。
 * 列表排序依赖 `game_catalog.currentPlayers`（由在线人数同步写入）。
 */
export class GameTopHeatPipelineService {
  private catalog = new GameCatalogRepository();
  private heat = new GameWeeklyHeatRepository();
  private store: SteamStoreService;
  private videos = new VideoRepository();
  private videoSources = new VideoSourceRepository();

  constructor(private env: Env) {
    this.store = new SteamStoreService(env);
  }

  async run(opts?: {
    topN?: number;
    delayMs?: number;
    maxReviews?: number;
    refreshPlayers?: boolean;
    syncDetails?: boolean;
    syncReviews?: boolean;
    /** 忽略周热度 7 天缓存，强制拉 Steam 在线人数 */
    forcePlayers?: boolean;
    reviewStaleHours?: number;
  }): Promise<TopHeatPipelineResult> {
    const topN = Math.max(1, Math.min(Number(opts?.topN ?? 500), 2000));
    const delayMs = Math.max(0, Math.min(Number(opts?.delayMs ?? 45), 2000));
    const maxReviews = Math.max(1, Math.min(Number(opts?.maxReviews ?? 50), 100));
    const refreshPlayers = opts?.refreshPlayers !== false;
    const syncDetails = opts?.syncDetails !== false;
    const syncReviews = opts?.syncReviews !== false;
    const reviewStaleMs = Math.max(1, Number(opts?.reviewStaleHours ?? 168)) * 3600 * 1000;

    const out: TopHeatPipelineResult = {
      topN,
      playersRefreshed: 0,
      playersFailed: 0,
      detailsSynced: 0,
      detailsFailed: 0,
      detailsSkipped: 0,
      reviewsLoaded: 0,
      reviewsFailed: 0,
      reviewsSkipped: 0,
    };

    const topRows = await this.catalog.listTopByCurrentPlayers(topN, 0);
    const appids = topRows.map((r) => r.appid);
    logger.info(`[top-heat-pipeline] start topN=${topN} appids=${appids.length}`);

    const weekKey = isoWeekKeyUTC();
    const nowMs = Date.now();

    if (refreshPlayers) {
      for (const appid of appids) {
        try {
          if (!opts?.forcePlayers) {
            const row = await this.heat.getByAppid(appid);
            const fetchedMs = row?.fetchedAt?.toMillis() ?? 0;
            if (fetchedMs > 0 && nowMs - fetchedMs < 6 * 3600 * 1000) {
              if (delayMs > 0) await wait(delayMs);
              continue;
            }
          }
          const n = await this.store.fetchCurrentPlayers(appid);
          const players = n ?? 0;
          await this.heat.upsertPlayerSnapshot(appid, players, { weekKey });
          await this.catalog.setPlayerHeatMirror(appid, players);
          out.playersRefreshed += 1;
        } catch (e) {
          out.playersFailed += 1;
          logger.warn(
            `[top-heat-pipeline] players appid=${appid} err=${e instanceof Error ? e.message : String(e)}`,
          );
        }
        if (delayMs > 0) await wait(delayMs);
      }
    }

    const hotAfter = await this.catalog.listTopByCurrentPlayers(topN, 0);

    if (syncDetails) {
      for (const row of hotAfter) {
        const appid = row.appid;
        if (row.lastDetailSyncAt || row.detailUnavailable) {
          out.detailsSkipped += 1;
          continue;
        }
        try {
          const detail = await this.store.fetchAppDetails(appid);
          if (!detail) {
            await this.catalog.markDetailUnavailable(appid);
            out.detailsFailed += 1;
            if (delayMs > 0) await wait(delayMs);
            continue;
          }
          const trailerClips = await mergeTrailerClipsForApp(this.env, appid, detail);
          await this.catalog.upsertMeta({
            appid,
            name: detail.name,
            headerImage: detail.headerImage,
            capsuleImage: detail.capsuleImage,
            screenshots: detail.screenshots ?? [],
            trailerUrls: trailerClips.map((c) => c.url),
            trailerThumbnailUrls: trailerClips.map((c) => c.thumbnailUrl ?? ''),
            shortDescription: detail.shortDescription,
            detailedDescription: detail.detailedDescription,
            steamStoreUrl: detail.steamStoreUrl,
            developers: detail.developers,
            publishers: detail.publishers,
            categories: detail.categories ?? [],
            genres: detail.genres ?? [],
            tags: detail.tags ?? [],
            isFree: detail.isFree,
            priceInitial: detail.priceInitial,
            priceFinal: detail.priceFinal,
            discountPercent: detail.discountPercent,
            steamDiscounted: detail.steamDiscounted,
          });
          await upsertSteamTrailersAsVideos(
            this.videos,
            this.videoSources,
            appid,
            detail.name,
            trailerClips,
            { headerImageFallback: detail.headerImage },
          );
          out.detailsSynced += 1;
        } catch (e) {
          out.detailsFailed += 1;
          logger.warn(
            `[top-heat-pipeline] detail appid=${appid} err=${e instanceof Error ? e.message : String(e)}`,
          );
        }
        if (delayMs > 0) await wait(delayMs);
      }
    }

    if (syncReviews) {
      const reviewTargets = await this.catalog.listTopByCurrentPlayers(topN, 0);
      for (const row of reviewTargets) {
        const appid = row.appid;
        if (!row.lastDetailSyncAt) {
          out.reviewsSkipped += 1;
          continue;
        }
        const lastMs = row.lastReviewsSyncedAt?.toMillis() ?? 0;
        const count = row.reviewCount ?? 0;
        if (lastMs > 0 && nowMs - lastMs < reviewStaleMs && count >= Math.min(maxReviews, 10)) {
          out.reviewsSkipped += 1;
          if (delayMs > 0) await wait(delayMs);
          continue;
        }
        try {
          const pack = await this.store.fetchSteamReviews(appid, { maxReviews });
          await this.catalog.saveReviews(appid, pack.summary, pack.reviews as Array<Record<string, unknown>>);
          out.reviewsLoaded += 1;
        } catch (e) {
          out.reviewsFailed += 1;
          logger.warn(
            `[top-heat-pipeline] reviews appid=${appid} err=${e instanceof Error ? e.message : String(e)}`,
          );
        }
        if (delayMs > 0) await wait(delayMs);
      }
    }

    logger.info(`[top-heat-pipeline] done ${JSON.stringify(out)}`);
    return out;
  }
}
