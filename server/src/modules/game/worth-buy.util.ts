import type { GameCatalogDoc, GameCountryPriceBucket } from './game-catalog.repository';

export type WorthBuyComponents = {
  /** 折扣力度 0–1 */
  D: number;
  /** 评论维度 0–1（无历史序列时中性 0.5） */
  R: number;
  /** 在线玩家维度 0–1 */
  P: number;
  /** 趋势/第三方热度 0–1 */
  T: number;
};

export type WorthBuySnapshot = WorthBuyComponents & {
  score: number;
  formula: string;
};

const FORMULA = '0.4*D+0.3*R+0.2*P+0.1*T';

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * 从多国桶 + 目录行粗算「值得买」指数（R 暂无时间序列时为 0.5）。
 */
export function computeWorthBuy(bucket: GameCountryPriceBucket, catalog: Pick<GameCatalogDoc, 'currentPlayers' | 'reviewSummary'>): WorthBuySnapshot {
  const itadDisc = Number(bucket.isthereanydeal?.discountPercent ?? 0);
  const steamDisc = Number(bucket.steam?.discountPercent ?? 0);
  const ggDisc = Number(bucket.ggdeals?.discountPercent ?? 0);
  const D = clamp01(Math.max(itadDisc, steamDisc, ggDisc) / 100);

  const reviews = Number(catalog.reviewSummary?.totalReviews ?? 0);
  const pos = Number(catalog.reviewSummary?.positivePercent ?? 0);
  const R = reviews > 0 ? clamp01(pos / 100) : 0.5;

  const players = Number(catalog.currentPlayers ?? 0);
  const P = players > 0 ? clamp01(Math.log1p(players) / Math.log1p(500_000)) : 0;

  const T = clamp01(ggDisc / 100 || (itadDisc > 0 ? itadDisc / 100 : 0));

  const score = 0.4 * D + 0.3 * R + 0.2 * P + 0.1 * T;
  return { D, R, P, T, score: clamp01(score), formula: FORMULA };
}
