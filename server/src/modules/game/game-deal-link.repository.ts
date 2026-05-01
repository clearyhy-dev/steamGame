import admin from 'firebase-admin';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import { getFirestore } from '../../config/firebase';

export type DealSource =
  | 'steam'
  | 'isthereanydeal'
  | 'ggdeals'
  | 'cheapshark'
  | 'affiliate'
  | 'fanatical'
  | 'cdkeys'
  | 'gearup'
  | 'manual';

export type GameDealLinkDoc = {
  dealId: string;
  appid: string;
  source: DealSource;
  url: string;
  isAffiliate: boolean;
  isActive: boolean;
  priority: number;
  countryCode?: string;
  startAt?: admin.firestore.Timestamp | null;
  endAt?: admin.firestore.Timestamp | null;
  currency?: string;
  originalPrice?: number;
  finalPrice?: number;
  discountPercent?: number;
  hotnessScore?: number;
  offerStatus?: 'active' | 'stale' | 'invalid';
  invalidReason?: string;
  lastCheckedAt?: admin.firestore.Timestamp;
  lastPriceSyncAt?: admin.firestore.Timestamp;
  createdAt: admin.firestore.Timestamp;
  updatedAt: admin.firestore.Timestamp;
};

const DEAL_COLLECTION = 'game_deal_links';

function toTsOrNull(v: unknown): admin.firestore.Timestamp | null | undefined {
  if (v === null) return null;
  if (v === undefined || v === '') return undefined;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) return undefined;
  return admin.firestore.Timestamp.fromDate(d);
}

export class GameDealLinkRepository {
  private db = getFirestore();

  isActiveNow(link: GameDealLinkDoc, nowMs = Date.now()): boolean {
    if (!link.isActive) return false;
    if ((link.offerStatus ?? 'active') === 'invalid') return false;
    const startMs = link.startAt ? link.startAt.toDate().getTime() : -Infinity;
    const endMs = link.endAt ? link.endAt.toDate().getTime() : Infinity;
    return nowMs >= startMs && nowMs <= endMs;
  }

  async listByAppid(appid: string): Promise<GameDealLinkDoc[]> {
    const snap = await this.db.collection(DEAL_COLLECTION).where('appid', '==', appid).get();
    return snap.docs
      .map((d: QueryDocumentSnapshot) => d.data() as GameDealLinkDoc)
      .sort((a, b) => a.priority - b.priority);
  }

  async listActiveByAppids(appids: string[]): Promise<Map<string, GameDealLinkDoc[]>> {
    const out = new Map<string, GameDealLinkDoc[]>();
    const uniq = Array.from(new Set(appids.map((x) => String(x || '').trim()).filter(Boolean)));
    if (uniq.length === 0) return out;
    const nowMs = Date.now();
    const chunkSize = 10; // Firestore "in" supports max 10 values
    for (let i = 0; i < uniq.length; i += chunkSize) {
      const part = uniq.slice(i, i + chunkSize);
      const snap = await this.db.collection(DEAL_COLLECTION).where('appid', 'in', part).where('isActive', '==', true).get();
      for (const d of snap.docs) {
        const row = d.data() as GameDealLinkDoc;
        if (!this.isActiveNow(row, nowMs)) continue;
        const arr = out.get(row.appid) ?? [];
        arr.push(row);
        out.set(row.appid, arr);
      }
    }
    for (const [appid, rows] of out.entries()) {
      out.set(
        appid,
        rows.sort((a, b) => a.priority - b.priority),
      );
    }
    return out;
  }

  async upsertForApp(
    appid: string,
    input: {
      dealId?: string;
      source: DealSource;
      url: string;
      isAffiliate?: boolean;
      isActive?: boolean;
      priority?: number;
      countryCode?: string;
      startAt?: string | null;
      endAt?: string | null;
      currency?: string;
      originalPrice?: number;
      finalPrice?: number;
      discountPercent?: number;
      hotnessScore?: number;
      offerStatus?: 'active' | 'stale' | 'invalid';
      invalidReason?: string;
      lastCheckedAt?: admin.firestore.Timestamp;
      lastPriceSyncAt?: admin.firestore.Timestamp;
    },
  ): Promise<GameDealLinkDoc> {
    const now = admin.firestore.Timestamp.now();
    const dealId = String(input.dealId ?? '').trim() || this.db.collection(DEAL_COLLECTION).doc().id;
    const ref = this.db.collection(DEAL_COLLECTION).doc(dealId);
    const old = await ref.get();
    const payload: Partial<GameDealLinkDoc> = {
      dealId,
      appid,
      source: input.source,
      url: input.url.trim(),
      isAffiliate: input.isAffiliate ?? input.source === 'affiliate',
      isActive: input.isActive ?? true,
      priority: Math.max(0, Math.min(Number(input.priority ?? 100), 9999)),
      countryCode: String(input.countryCode ?? '').trim().toUpperCase() || 'US',
      startAt: toTsOrNull(input.startAt),
      endAt: toTsOrNull(input.endAt),
      currency: input.currency,
      originalPrice: typeof input.originalPrice === 'number' ? input.originalPrice : undefined,
      finalPrice: typeof input.finalPrice === 'number' ? input.finalPrice : undefined,
      discountPercent: typeof input.discountPercent === 'number' ? input.discountPercent : undefined,
      hotnessScore: typeof input.hotnessScore === 'number' ? input.hotnessScore : undefined,
      offerStatus: input.offerStatus,
      invalidReason: input.invalidReason,
      lastCheckedAt: input.lastCheckedAt,
      lastPriceSyncAt: input.lastPriceSyncAt,
      updatedAt: now,
      createdAt: old.exists ? ((old.data() as GameDealLinkDoc).createdAt ?? now) : now,
    };
    for (const [k, v] of Object.entries(payload)) {
      if (v === undefined) {
        delete (payload as Record<string, unknown>)[k];
      }
    }
    await ref.set(payload, { merge: true });
    const fresh = await ref.get();
    return fresh.data() as GameDealLinkDoc;
  }

  async markStaleOlderThan(ttlHours: number, maxScan = 1500): Promise<{ scanned: number; staleMarked: number }> {
    const ttlMs = Math.max(1, Number(ttlHours || 6)) * 3600 * 1000;
    const cutoff = Date.now() - ttlMs;
    const snap = await this.db
      .collection(DEAL_COLLECTION)
      .orderBy('updatedAt', 'asc')
      .limit(Math.max(1, Math.min(maxScan, 5000)))
      .get();
    let scanned = 0;
    let staleMarked = 0;
    let batch = this.db.batch();
    let opCount = 0;
    for (const d of snap.docs) {
      scanned += 1;
      const row = d.data() as GameDealLinkDoc;
      if (!row.isActive) continue;
      const last = row.lastPriceSyncAt?.toDate().getTime() ?? row.updatedAt?.toDate().getTime() ?? 0;
      if (last <= 0 || last >= cutoff) continue;
      if ((row.offerStatus ?? 'active') === 'invalid') continue;
      batch.update(d.ref, { offerStatus: 'stale', updatedAt: admin.firestore.Timestamp.now() });
      staleMarked += 1;
      opCount += 1;
      if (opCount >= 450) {
        await batch.commit();
        batch = this.db.batch();
        opCount = 0;
      }
    }
    if (opCount > 0) await batch.commit();
    return { scanned, staleMarked };
  }

  pickBestDeal(
    appid: string,
    links: GameDealLinkDoc[],
    opts?: { steamDiscountPercent?: number; steamStoreUrl?: string },
  ): { appid: string; url: string; source: string; dealId?: string } {
    const nowMs = Date.now();
    const active = links
      .filter((l) => this.isActiveNow(l, nowMs))
      .sort((a, b) => a.priority - b.priority);

    const affiliate = active.find((l) => l.isAffiliate);
    if (affiliate) return { appid, url: affiliate.url, source: affiliate.source, dealId: affiliate.dealId };

    const steamDiscountPercent = opts?.steamDiscountPercent ?? 0;
    const steamStoreUrl = opts?.steamStoreUrl ?? `https://store.steampowered.com/app/${appid}`;
    if (steamDiscountPercent > 0) {
      const steamLink = active.find((l) => l.source === 'steam');
      if (steamLink) return { appid, url: steamLink.url, source: steamLink.source, dealId: steamLink.dealId };
      return { appid, url: steamStoreUrl, source: 'steam' };
    }

    return { appid, url: steamStoreUrl, source: 'steam_store' };
  }
}

