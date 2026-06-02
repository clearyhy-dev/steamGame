import { logger } from '../../utils/logger';
import type { Env } from '../../config/env';
import { SteamStoreService } from '../steam/steam-store.service';
import { GameCatalogRepository } from './game-catalog.repository';
import { GameWeeklyHeatRepository, isoWeekKeyUTC } from './game-weekly-heat.repository';

const WEEK_MS = 7 * 24 * 3600 * 1000;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type WeeklyHeatSyncResult = {
  scanned: number;
  refreshed: number;
  skippedFresh: number;
  failed: number;
  nextCursorAppid: string | null;
  /** catalog 游标后是否还有下一页 */
  hasMore: boolean;
};

/**
 * 将 Steam 当前在线人数写入 `game_weekly_heat`，并把 `game_catalog.currentPlayers` / `lastPlayersSyncAt`
 * 作为列表排序镜像（详情同步不再写人数）。
 */
export class GameWeeklyHeatSyncService {
  constructor(private env: Env) {}

  /**
   * 跑一页 catalog 扫描；默认跳过「7 天内已拉过」的游戏（`force` 时全拉）。
   */
  async runPage(params?: {
    cursorAppid?: string;
    pageSize?: number;
    delayMs?: number;
    force?: boolean;
  }): Promise<WeeklyHeatSyncResult> {
    const pageSize = Math.max(50, Math.min(Number(params?.pageSize ?? 300), 500));
    const delayMs = Math.max(0, Math.min(Number(params?.delayMs ?? 40), 2000));
    const force = params?.force === true;
    const cursor = String(params?.cursorAppid ?? '').trim();

    const store = new SteamStoreService(this.env);
    const heat = new GameWeeklyHeatRepository();
    const catalog = new GameCatalogRepository();

    const { candidates, lastScannedAppid, hasMore } = await heat.listCatalogAppidsPageForHeatSync(cursor, pageSize);
    if (candidates.length === 0) {
      return {
        scanned: 0,
        refreshed: 0,
        skippedFresh: 0,
        failed: 0,
        nextCursorAppid: hasMore ? lastScannedAppid : null,
        hasMore,
      };
    }

    const existing = await heat.getByAppids(candidates);
    const nowMs = Date.now();
    const weekKey = isoWeekKeyUTC(new Date(nowMs));

    let refreshed = 0;
    let skippedFresh = 0;
    let failed = 0;

    for (const appid of candidates) {
      try {
        if (!force) {
          const row = existing.get(appid);
          const fetchedMs = row?.fetchedAt?.toMillis() ?? 0;
          if (fetchedMs > 0 && nowMs - fetchedMs < WEEK_MS) {
            skippedFresh += 1;
            if (delayMs > 0) await wait(delayMs);
            continue;
          }
        }
        const n = await store.fetchCurrentPlayers(appid);
        const players = n ?? 0;
        await heat.upsertPlayerSnapshot(appid, players, { weekKey });
        await catalog.setPlayerHeatMirror(appid, players);
        refreshed += 1;
      } catch (e) {
        failed += 1;
        logger.warn(
          `[weekly-heat] appid=${appid} err=${e instanceof Error ? e.message : String(e)}`,
        );
      }
      if (delayMs > 0) await wait(delayMs);
    }

    return {
      scanned: candidates.length,
      refreshed,
      skippedFresh,
      failed,
      nextCursorAppid: lastScannedAppid,
      hasMore,
    };
  }
}
