import { Layout, Menu, theme } from 'antd';
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
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { adminApi } from '../api/admin';
import { setToken } from '../api/client';

const { Header, Sider, Content } = Layout;

const items = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/video-sources', icon: <DatabaseOutlined />, label: 'Video Sources' },
  { key: '/videos', icon: <PlayCircleOutlined />, label: 'Videos' },
  { key: '/video-jobs', icon: <UnorderedListOutlined />, label: 'Video Jobs' },
  { key: '/steam-games', icon: <AppstoreOutlined />, label: 'App Games' },
  { key: '/users', icon: <TeamOutlined />, label: 'Users' },
  { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
  { key: '/request-logs', icon: <FileSearchOutlined />, label: 'Request Logs' },
  { key: '/country-region-mapping', icon: <SettingOutlined />, label: 'Country / Steam' },
];

export function AdminLayout() {
  const nav = useNavigate();
  const loc = useLocation();
  const {
    token: { colorBgContainer },
  } = theme.useToken();

  /** pathname 形如 /admin/dashboard 或 /admin/videos/xxx（含 basename） */
  let rest = loc.pathname.replace(/^\/admin\/?/, '');
  if (!rest) rest = 'dashboard';
  const first = rest.split('/')[0] ?? 'dashboard';
  const selected = `/${first}`;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* 不使用 collapsedWidth={0}+breakpoint：窄屏/DevTools 贴边时易触发抽屉遮罩导致主区域灰屏不可点 */}
      <Sider width={220} theme="dark" style={{ overflow: 'auto' }}>
        <div style={{ height: 48, margin: 16, color: '#fff', fontWeight: 600 }}>Video Admin</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected]}
          items={items}
          onClick={({ key }) => {
            nav(key);
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
