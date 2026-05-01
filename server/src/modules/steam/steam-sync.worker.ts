import admin from 'firebase-admin';
import type { Env } from '../../config/env';
import { getEffectiveEnv } from '../../config/runtime-config';
import { logger } from '../../utils/logger';
import { GameCatalogRepository } from '../game/game-catalog.repository';
import { SteamStoreService } from './steam-store.service';
import { SteamSyncJobRepository } from './steam-sync-job.repository';

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
      void tick(baseEnv);
    }, interval);
    void tick(baseEnv);
  })();
}

async function tick(baseEnv: Env): Promise<void> {
  if (busy) return;
  busy = true;
  const env = await getEffectiveEnv(baseEnv);
  if (!env.steamAutoSyncEnabled) {
    busy = false;
    return;
  }
  const store = new SteamStoreService(baseEnv);
  const catalog = new GameCatalogRepository();
  const jobs = new SteamSyncJobRepository();
  const startedAt = Date.now();
  let appListProcessed = 0;
  let appListInserted = 0;
  let appListUpdated = 0;
  let detailTotal = 0;
  let detailSuccess = 0;
  let detailFailed = 0;
  try {
    logger.info('[steam.sync.worker] tick start');
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
    const appListOut = await catalog.upsertAppListItems(items, { chunkSize: 400 });
    appListProcessed = appListOut.processed;
    appListInserted = appListOut.inserted;
    appListUpdated = appListOut.updated;
    logger.info(
      `[steam.sync.worker] applist done processed=${appListOut.processed} inserted=${appListOut.inserted} updated=${appListOut.updated} skipped=${appListOut.skipped}`,
    );

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
          failed += 1;
        } else {
          await catalog.upsertMeta({
            appid,
            name: detail.name,
            headerImage: detail.headerImage,
            capsuleImage: detail.capsuleImage,
            screenshots: detail.screenshots ?? [],
            trailerUrls: detail.trailerUrls ?? [],
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
            currentPlayers: detail.currentPlayers ?? 0,
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
    await jobs.create({
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
  } catch (e) {
    logger.error(`[steam.sync.worker] tick failed err=${e instanceof Error ? e.message : String(e)}`);
    await jobs.create({
      trigger: 'worker',
      status: 'failed',
      appListProcessed,
      appListInserted,
      appListUpdated,
      detailTotal,
      detailSuccess,
      detailFailed,
      message: e instanceof Error ? e.message : String(e),
      startedAt: admin.firestore.Timestamp.fromMillis(startedAt),
      finishedAt: admin.firestore.Timestamp.now(),
      elapsedMs: Date.now() - startedAt,
    });
  } finally {
    busy = false;
  }
}

