import admin from 'firebase-admin';
import { getFirestore } from '../../config/firebase';
import { mergePlayersDaily, type GameCatalogDoc } from './game-catalog.repository';

const COLLECTION = 'game_weekly_heat';

/** 每周（或可配置间隔）从 Steam 拉取的在线人数主数据；`game_catalog.currentPlayers` 仅作列表排序镜像 */
export type GameWeeklyHeatDoc = {
  appid: string;
  currentPlayers: number;
  /** 例如 `2026-W19`，便于运营按周查看 */
  weekKey: string;
  fetchedAt: admin.firestore.Timestamp;
  /** 按日快照（在每次周同步写入当天点） */
  playersDaily?: Array<{ day: string; players: number }>;
  updatedAt: admin.firestore.Timestamp;
  createdAt: admin.firestore.Timestamp;
};

export function isoWeekKeyUTC(d = new Date()): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const z = new Date(Date.UTC(y, 0, 1));
  const week = Math.ceil(((t.getTime() - z.getTime()) / 86400000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}

export class GameWeeklyHeatRepository {
  private db = getFirestore();

  collectionRef() {
    return this.db.collection(COLLECTION);
  }

  async getByAppid(appid: string): Promise<GameWeeklyHeatDoc | null> {
    const key = String(appid ?? '').trim();
    if (!key) return null;
    const snap = await this.collectionRef().doc(key).get();
    if (!snap.exists) return null;
    return snap.data() as GameWeeklyHeatDoc;
  }

  async getByAppids(appids: string[]): Promise<Map<string, GameWeeklyHeatDoc>> {
    const out = new Map<string, GameWeeklyHeatDoc>();
    const uniq = Array.from(new Set(appids.map((x) => String(x ?? '').trim()).filter(Boolean)));
    for (let i = 0; i < uniq.length; i += 10) {
      const part = uniq.slice(i, i + 10);
      const snaps = await this.db.getAll(...part.map((id) => this.collectionRef().doc(id)));
      for (const s of snaps) {
        if (!s.exists) continue;
        const d = s.data() as GameWeeklyHeatDoc;
        out.set(d.appid, d);
      }
    }
    return out;
  }

  async upsertPlayerSnapshot(
    appid: string,
    currentPlayers: number,
    opts?: { weekKey?: string; playersDaily?: Array<{ day: string; players: number }> },
  ): Promise<void> {
    const key = String(appid ?? '').trim();
    if (!key) return;
    const ref = this.collectionRef().doc(key);
    const now = admin.firestore.Timestamp.now();
    const weekKey = opts?.weekKey ?? isoWeekKeyUTC(now.toDate());
    const n = Math.max(0, Math.trunc(Number(currentPlayers)));
    await this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const base = snap.exists ? (snap.data() as GameWeeklyHeatDoc) : null;
      const daily =
        opts?.playersDaily !== undefined
          ? opts.playersDaily
          : mergePlayersDaily(base?.playersDaily, n);
      const payload: GameWeeklyHeatDoc = {
        appid: key,
        currentPlayers: n,
        weekKey,
        fetchedAt: now,
        playersDaily: daily,
        updatedAt: now,
        createdAt: base?.createdAt ?? now,
      };
      tx.set(ref, payload, { merge: true });
    });
  }

  /**
   * 按 `appid` 顺序扫描 catalog；仅返回已详情同步的 appid。`lastScannedAppid` 为本页最后一行（用于游标，避免漏扫）。
   */
  /**
   * 按 appid 顺序扫描全库（用于广覆盖周同步）；不再要求已详情同步。
   */
  async listCatalogAppidsPageForHeatSync(
    afterAppid: string,
    limit: number,
  ): Promise<{ candidates: string[]; lastScannedAppid: string | null; hasMore: boolean }> {
    const lim = Math.max(1, Math.min(Math.trunc(limit) || 200, 500));
    let q = this.db.collection('game_catalog').orderBy('appid', 'asc').limit(lim);
    const cur = String(afterAppid ?? '').trim();
    if (cur) q = q.startAfter(cur);
    const snap = await q.get();
    if (snap.empty) return { candidates: [], lastScannedAppid: null, hasMore: false };
    const candidates = snap.docs.map((d) => (d.data() as GameCatalogDoc).appid);
    const last = snap.docs[snap.docs.length - 1]?.data() as GameCatalogDoc | undefined;
    return { candidates, lastScannedAppid: last?.appid ?? null, hasMore: snap.size >= lim };
  }
}
