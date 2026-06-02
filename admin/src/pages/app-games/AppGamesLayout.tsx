import { Outlet } from 'react-router-dom';
import { Alert, Select, Space, Tag, Typography } from 'antd';
import { AppGamesWorkspaceProvider, useAppGamesWorkspace } from './appGamesContext';
import { GameDetailModal } from './GameDetailModal';

function MarketCountryBar() {
  const { insightCountry, setInsightCountry, regionCountryOptions, regionCountriesReady } = useAppGamesWorkspace();
  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 12 }}
      message={
        <Space wrap>
          <Typography.Text strong>App 分桶国（全局锁定）</Typography.Text>
          <Select
            size="small"
            style={{ width: 200 }}
            value={insightCountry}
            loading={!regionCountriesReady}
            options={regionCountryOptions}
            onChange={setInsightCountry}
          />
          <Tag>{insightCountry}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            与 Flutter AppCountryResolver 一致；Steam/ITAD 等列表的分桶列与此国对齐。分国 v2 完整数据见「分国市场 v2」页。
          </Typography.Text>
        </Space>
      }
    />
  );
}

function AppGamesLayoutInner() {
  return (
    <>
      <MarketCountryBar />
      <GameDetailModal />
      <Outlet />
    </>
  );
}

/** App Games 五页共享同一 Workspace（列表状态、详情 Modal、批量任务结果等） */
export function AppGamesLayout() {
  return (
    <AppGamesWorkspaceProvider>
      <AppGamesLayoutInner />
    </AppGamesWorkspaceProvider>
  );
}
