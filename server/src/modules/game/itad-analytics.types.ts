import type admin from 'firebase-admin';

/** ITAD 金额（与 API `amount` + `currency` 对齐，展示单位而非 minor） */
export type ItadMoneySnapshot = {
  amount: number;
  currency: string;
};

/** 单店当前报价（多店聚合） */
export type ItadStoreOfferSnapshot = {
  shopId: number;
  shopName: string;
  url: string;
  cut: number;
  price: ItadMoneySnapshot;
  regular: ItadMoneySnapshot;
};

/** 价格历史单点（截断存储） */
export type ItadHistoryPointSnapshot = {
  timestamp: string;
  shopId?: number;
  shopName?: string;
  cut?: number;
  price?: ItadMoneySnapshot;
  regular?: ItadMoneySnapshot;
};

/** Bundle 摘要 */
export type ItadBundleSnapshot = {
  id: number;
  title: string;
  url: string;
  publish?: string;
  expiry?: string | null;
  shopName?: string;
};

/**
 * 按 **App 配置国家**（countryCode，如 US）存一份 ITAD 分析结果；
 * `itadApiCountry` 为实际请求 ITAD 时使用的 ISO2（可能与 steam 区一致）。
 */
export type ItadCountrySnapshot = {
  itadGameId: string;
  /** 写入 Firestore 时用 Timestamp；API 输出转 ISO 字符串 */
  syncedAt: admin.firestore.Timestamp | string;
  itadApiCountry: string;
  historyLow?: {
    all?: ItadMoneySnapshot;
    y1?: ItadMoneySnapshot;
    m3?: ItadMoneySnapshot;
  };
  stats?: {
    waitlisted?: number;
    collected?: number;
    rank?: number;
  };
  /** 多店当前价 + 购买链接 */
  storeOffers: ItadStoreOfferSnapshot[];
  priceHistory: ItadHistoryPointSnapshot[];
  bundles: ItadBundleSnapshot[];
  /** Steam(shop 61) 现价相对史低是否接近（启发式：≤15% 高于史低） */
  nearHistoricalLow?: boolean;
  steamAppId?: string;
  errors?: string[];
};

/**
 * 「值得买指数」占位（后续用 D/R/P/T 归一化后写入）。
 * Score ≈ 0.4*D + 0.3*R + 0.2*P + 0.1*T（需在任务里统一量纲）。
 */
export type WorthBuyIndexSnapshot = {
  score: number;
  D: number;
  R: number;
  P: number;
  T: number;
  computedAt: admin.firestore.Timestamp;
};
