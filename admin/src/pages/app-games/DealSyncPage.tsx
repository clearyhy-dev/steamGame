import { Button, Space, Typography } from 'antd';
import { useAppGamesWorkspace } from './appGamesContext';

/** 多渠道折扣批量抓取（按启用国家写 `game_discount_offers`）；逻辑在 `appGamesContext`，列表页工具栏复用同一套方法 */
export function AppGamesDealSyncPage() {
  const {
    syncingDealsBatch,
    runDealSyncFullBatch,
    runDealSyncContinueBatch,
    runDealSyncHotTop,
    syncDealsBySources,
    lastDealSyncHint,
  } = useAppGamesWorkspace();

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        折扣同步
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        默认按「国家 / Steam」页启用国家逐国拉 Steam / GG / ITAD / CheapShark。列表页「本页折扣同步」仅同步<strong>当前表格中的 appid</strong>；本页「批量」按库内 appid 游标顺序。结果见「同步结果」。
        每日自动拉价请在侧边栏 <a href="/admin/scheduled-tasks">定时任务</a> 查看（Top1000×四平台、全库游标、按平台×国别热度均已默认每日启用）。
      </Typography.Paragraph>
      {lastDealSyncHint ? (
        <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
          最近批量：{lastDealSyncHint}
        </Typography.Paragraph>
      ) : null}
      <Space wrap>
        <Button loading={syncingDealsBatch} type="primary" onClick={() => void runDealSyncFullBatch()}>
          批量获取折扣(100)
        </Button>
        <Button loading={syncingDealsBatch} onClick={() => void syncDealsBySources(['steam'])}>
          Steam 折扣批量
        </Button>
        <Button loading={syncingDealsBatch} onClick={() => void syncDealsBySources(['isthereanydeal'])}>
          ITAD 折扣批量
        </Button>
        <Button loading={syncingDealsBatch} onClick={() => void syncDealsBySources(['ggdeals'])}>
          GG 折扣批量
        </Button>
        <Button loading={syncingDealsBatch} onClick={() => void syncDealsBySources(['cheapshark'])}>
          CheapShark 折扣批量
        </Button>
        <Button loading={syncingDealsBatch} onClick={() => void runDealSyncHotTop()}>
          热度 Top1000 更新
        </Button>
        <Button loading={syncingDealsBatch} onClick={() => void runDealSyncContinueBatch()}>
          继续获取下一批折扣
        </Button>
      </Space>
    </div>
  );
}
