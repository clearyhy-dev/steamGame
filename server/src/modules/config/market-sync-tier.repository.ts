import admin from 'firebase-admin';
import { getFirestore } from '../../config/firebase';
import { useSqliteRelationalStore } from '../../config/database';
import { sqlGet, sqlRun } from '../../storage/sqlite/sql-client';
import {
  DEFAULT_MARKET_SYNC_TIER_SETTINGS,
  mergeMarketSyncTierSettings,
  type MarketSyncTierSettings,
} from './market-sync-tier.config';

const COLLECTION = 'system_config';
const DOC_ID = 'market_sync_tier';
const SQLITE_KEY = 'market_sync_tier';

export class MarketSyncTierRepository {
  private db = getFirestore();

  async getSettings(): Promise<MarketSyncTierSettings> {
    if (useSqliteRelationalStore()) {
      const row = await sqlGet<{ value: string }>('SELECT value FROM config_runtime WHERE key = ?', [SQLITE_KEY]);
      if (!row?.value) return { ...DEFAULT_MARKET_SYNC_TIER_SETTINGS };
      try {
        return mergeMarketSyncTierSettings(JSON.parse(row.value) as Partial<MarketSyncTierSettings>);
      } catch {
        return { ...DEFAULT_MARKET_SYNC_TIER_SETTINGS };
      }
    }
    const snap = await this.db.collection(COLLECTION).doc(DOC_ID).get();
    if (!snap.exists) return { ...DEFAULT_MARKET_SYNC_TIER_SETTINGS };
    const data = snap.data() as Partial<MarketSyncTierSettings>;
    return mergeMarketSyncTierSettings(data);
  }

  async saveSettings(patch: Partial<MarketSyncTierSettings>): Promise<MarketSyncTierSettings> {
    const merged = mergeMarketSyncTierSettings({
      ...(await this.getSettings()),
      ...patch,
    });
    if (useSqliteRelationalStore()) {
      await sqlRun(
        `INSERT INTO config_runtime (key, value) VALUES (?,?)
         ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        [SQLITE_KEY, JSON.stringify(merged)],
      );
      return merged;
    }
    const now = admin.firestore.Timestamp.now();
    await this.db.collection(COLLECTION).doc(DOC_ID).set(
      { ...merged, updatedAt: now },
      { merge: true },
    );
    return merged;
  }
}
