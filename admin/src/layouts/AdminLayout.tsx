import { Layout, Menu, theme } from 'antd';
import type { MenuProps } from 'antd';
import {
  DashboardOutlined,
  DatabaseOutlined,
  PlayCircleOutlined,
  UnorderedListOutlined,
  LogoutOutlined,
  AppstoreOutlined,
  TeamOutlined,
  SettingOutlined,
  FileSearchOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { adminApi } from '../api/admin';
import { setToken } from '../api/client';

const { Header, Sider, Content } = Layout;

const menuItems: MenuProps['items'] = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/video-sources', icon: <DatabaseOutlined />, label: 'Video Sources' },
  { key: '/videos', icon: <PlayCircleOutlined />, label: 'Videos' },
  { key: '/video-jobs', icon: <UnorderedListOutlined />, label: 'Video Jobs' },
  {
    key: 'sub-app-games',
    icon: <AppstoreOutlined />,
    label: 'App Games',
    children: [
      { key: '/app-games/market', label: '分国市场 v2' },
      { key: '/app-games/steam', label: 'Steam 列表' },
      { key: '/app-games/itad', label: 'ITAD 价格分析' },
      { key: '/app-games/gg', label: 'GG 发现/趋势' },
      { key: '/app-games/cheapshark', label: 'CheapShark' },
      { key: '/app-games/worth-buy', label: '值得买指数' },
      { key: '/app-games/catalog-sync', label: 'Steam 目录同步' },
      { key: '/app-games/detail-sync', label: '详情同步' },
      { key: '/app-games/deal-sync', label: '折扣同步' },
      { key: '/app-games/sync-results', label: '同步结果' },
    ],
  },
  { key: '/users', icon: <TeamOutlined />, label: 'Users' },
  { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
  { key: '/scheduled-tasks', icon: <ClockCircleOutlined />, label: 'Scheduled Tasks' },
  { key: '/sqlite-database', icon: <DatabaseOutlined />, label: 'SQLite 数据库' },
  { key: '/app-diagnostics', icon: <FileSearchOutlined />, label: 'App Diagnostics' },
  { key: '/request-logs', icon: <FileSearchOutlined />, label: 'Request Logs' },
  { key: '/country-region-mapping', icon: <SettingOutlined />, label: 'Country / Steam' },
];

export function AdminLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const {
    token: { colorBgContainer },
  } = theme.useToken();

  let rest = loc.pathname.replace(/^\/admin\/?/, '');
  if (!rest) rest = 'dashboard';
  const selectedKey = rest.includes('app-games/') ? `/${rest}` : `/${rest.split('/')[0]}`;

  const [openKeys, setOpenKeys] = useState<string[]>([]);
  useEffect(() => {
    if (rest.startsWith('app-games')) setOpenKeys(['sub-app-games']);
    else setOpenKeys([]);
  }, [rest]);

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* 不使用 collapsedWidth={0}+breakpoint：窄屏/DevTools 贴边时易触发抽屉遮罩导致主区域灰屏不可点 */}
      <Sider width={220} theme="dark" style={{ overflow: 'auto' }}>
        <div style={{ height: 48, margin: 16, color: '#fff', fontWeight: 600 }}>Video Admin</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          openKeys={openKeys}
          onOpenChange={(keys) => setOpenKeys(keys as string[])}
          items={menuItems}
          onClick={({ key }) => {
            if (typeof key === 'string' && key.startsWith('/')) nav(key);
          }}
        />
      </Sider>
      <Layout>
        <Header style={{ padding: '0 24px', background: colorBgContainer, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <a
            onClick={async () => {
              try {
                await adminApi.logout();
              } finally {
                setToken(null);
                nav('/login', { replace: true });
              }
            }}
            style={{ cursor: 'pointer' }}
          >
            <LogoutOutlined /> 退出
          </a>
        </Header>
        <Content style={{ margin: 16 }}>
          <div style={{ padding: 24, minHeight: 360, background: colorBgContainer }}>
            <Outlet />
          </div>
        </Content>
      </Layout>
    </Layout>
  );
}
