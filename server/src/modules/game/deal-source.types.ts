/** 折扣来源（主站四源 + 手工/联盟等），与 `game_discount_offers` 主源 / `extraDeals` 一致 */
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
