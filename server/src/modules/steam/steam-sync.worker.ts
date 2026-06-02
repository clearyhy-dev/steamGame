import admin from 'firebase-admin';
import type { Env } from '../../config/env';
import { getEffectiveEnv } from '../../config/runtime-config';
import { logger } from '../../utils/logger';
import { GameCatalogRepository } from '../game/game-catalog.repository';
import { SteamStoreService } from './steam-store.service';
import { SteamSyncJobRepository } from './steam-sync-job.repository';
import { VideoRepository } from '../video/video.repository';
import { VideoSourceRepository } from '../video/video-source.repository';
import { upsertSteamTrailersAsVideos } from '../video/sync-steam-trailers-to-videos.service';
import { fetchSteamTrailerMp4 } from '../video/steam-trailer.util';

let busy = false;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function startSteamSyncWorker(baseEnv: Env): void {
  void (async () => {
    const env = await getEffectiveEnv(baseEnv);
    if (!env.steamAutoSyncEnabled) {
      logger.info('Steam sync worker disabled');
      return;
    }
    const interval = Math.max(5 * 60 * 1000, env.steamAutoSyncIntervalMs);
    logger.info(`Steam sync worker started (interval=${interval}ms)`);
    setInterval(() => {
      void runSteamCatalogSyncTick(baseEnv);
    }, interval);
    void runSteamCatalogSyncTick(baseEnv);
  })();
}

export type SteamCatalogSyncTickOutcome = {
  ok: boolean;
  skipped?: boolean;
  summary: string;
  error?: string;
};

/** 供计划任务 / 手动触发复用（与定时 worker 同一套逻辑）。 */
export async function runSteamCatalogSyncTick(
  baseEnv: Env,
  opts?: { bypassEnabledGate?: boolean },
): Promise<SteamCatalogSyncTickOutcome> {
  if (busy) {
    return { ok: true, skipped: true, summary: '上一轮仍在执行，本次跳过' };
  }
  busy = true;
  const startedAt = Date.now();
  let appListProcessed = 0;
  let appListInserted = 0;
  let appListUpdated = 0;
  let detailTotal = 0;
  let detailSuccess = 0;
  let detailFailed = 0;
  try {
    const env = await getEffectiveEnv(baseEnv);
    if (!opts?.bypassEnabledGate && !env.steamAutoSyncEnabled) {
      return { ok: true, skipped: true, summary: 'Steam 自动同步已关闭，已跳过' };
    }
    const store = new SteamStoreService(baseEnv);
    const catalog = new GameCatalogRepository();
    const syncJobs = new SteamSyncJobRepository();
    const videos = new VideoRepository();
    const videoSources = new VideoSourceRepository();
    logger.info('[steam.sync.worker] tick start');
    const catalogCount = await catalog.countAll();
    if (catalogCount < 70_000) {
      const appList = await store.fetchAppList();
      if (appList.length === 0) {
        throw new Error('Steam AppList empty from upstream');
      }
      const dedup = new Map<string, string>();
      for (const g of appList) {
        if (!g.appid || dedup.has(g.appid)) continue;
        dedup.set(g.appid, g.name || `App ${g.appid}`);
      }
      const items = Array.from(dedup.entries()).map(([appid, name]) => ({ appid, name }));
      const appListOut = await catalog.upsertAppListItems(items, { chunkSize: 200 });
      appListProcessed = appListOut.processed;
      appListInserted = appListOut.inserted;
      appListUpdated = appListOut.updated;
      logger.info(
        `[steam.sync.worker] applist done processed=${appListOut.processed} inserted=${appListOut.inserted} updated=${appListOut.updated} skipped=${appListOut.skipped}`,
      );
    } else {
      logger.info(`[steam.sync.worker] skip applist refresh catalogCount=${catalogCount}`);
    }

    const batchSize = Math.max(100, Math.min(env.steamAutoSyncBatchSize, 500));
    const delayMs = Math.max(0, Math.min(env.steamAutoSyncDelayMs, 2000));
    const { rows: unsyncedRows } = await catalog.listUnsyncedByCursor('', batchSize);
    const candidates = unsyncedRows.map((x) => x.appid);
    detailTotal = candidates.length;
    let success = 0;
    let failed = 0;
    for (const appid of candidates) {
      try {
        const detail = await store.fetchAppDetails(appid);
        if (!detail) {
          await catalog.markDetailUnavailable(appid);
          failed += 1;
        } else {
          let trailerClips = [...(detail.trailerClips ?? [])];
          if (trailerClips.length === 0 && (detail.trailerUrls ?? []).length > 0) {
            const thumbs = detail.trailerThumbnailUrls ?? [];
            trailerClips = (detail.trailerUrls ?? []).map((url, i) => ({
              url,
              thumbnailUrl: thumbs[i] || undefined,
            }));
          }
          try {
            const t = await fetchSteamTrailerMp4(baseEnv, appid);
            if (t.mp4Url) {
              const hit = trailerClips.find((c) => c.url === t.mp4Url);
              if (hit) {
                if (t.thumbnailUrl && !hit.thumbnailUrl) hit.thumbnailUrl = t.thumbnailUrl;
              } else {
                trailerClips = [{ url: t.mp4Url, thumbnailUrl: t.thumbnailUrl }, ...trailerClips];
              }
            }
          } catch {
            /* no trailer */
          }
          const trailerUrls = trailerClips.map((c) => c.url).slice(0, 8);
          const trailerThumbnailUrls = trailerClips.map((c) => c.thumbnailUrl ?? '').slice(0, 8);
          trailerClips = trailerClips.slice(0, 8);
          await catalog.upsertMeta({
            appid,
            name: detail.name,
            headerImage: detail.headerImage,
            capsuleImage: detail.capsuleImage,
            screenshots: detail.screenshots ?? [],
            trailerUrls,
            trailerThumbnailUrls,
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
          await upsertSteamTrailersAsVideos(videos, videoSources, appid, detail.name, trailerClips, {
            headerImageFallback: detail.headerImage,
          });
          success += 1;
        }
      } catch (e) {
        failed += 1;
        logger.warn(`[steam.sync.worker] detail failed appid=${appid} err=${e instanceof Error ? e.message : String(e)}`);
      }
      if (delayMs > 0) await wait(delayMs);
    }
    detailSuccess = success;
    detailFailed = failed;
    logger.info(`[steam.sync.worker] details done total=${candidates.length} success=${success} failed=${failed}`);
    const summary = `应用列表 处理=${appListProcessed} 新增=${appListInserted} 更新=${appListUpdated}；详情 本批=${detailTotal} 成功=${detailSuccess} 失败=${detailFailed}`;
    await syncJobs.create({
      trigger: 'worker',
      status: failed > 0 ? 'partial' : 'success',
      appListProcessed,
      appListInserted,
      appListUpdated,
      detailTotal,
      detailSuccess,
      detailFailed,
      startedAt: admin.firestore.Timestamp.fromMillis(startedAt),
      finishedAt: admin.firestore.Timestamp.now(),
      elapsedMs: Date.now() - startedAt,
    });
    const ok = detailTotal === 0 ? true : detailSuccess > 0;
    const error =
      detailTotal > 0 && detailSuccess === 0
        ? `本批 ${detailTotal} 款详情同步均未成功`
        : detailFailed > 0
          ? `本批部分失败 ${detailFailed}/${detailTotal}（Steam API 限流/无详情属常见情况）`
          : undefined;
    return { ok, summary, error: ok ? undefined : error };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`[steam.sync.worker] tick failed err=${msg}`);
    await new SteamSyncJobRepository().create({
      trigger: 'worker',
      status: 'failed',
      appListProcessed,
      appListInserted,
      appListUpdated,
      detailTotal,
      detailSuccess,
      detailFailed,
      message: msg,
      startedAt: admin.firestore.Timestamp.fromMillis(startedAt),
      finishedAt: admin.firestore.Timestamp.now(),
      elapsedMs: Date.now() - startedAt,
    });
    return { ok: false, summary: `失败: ${msg}`, error: msg };
  } finally {
    busy = false;
  }
}

