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
} from '@ant-design/icons';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { adminApi } from '../api/admin';
import { setToken } from '../api/client';

const { Header, Sider, Content } = Layout;

const items = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: 'Dashboard' },
  { key: '/video-sources', icon: <DatabaseOutlined />, label: 'Video Sources' },
  { key: '/videos', icon: <PlayCircleOutlined />, label: 'Videos' },
  { key: '/youtube-videos', icon: <PlayCircleOutlined />, label: 'YouTube Videos' },
  { key: '/video-jobs', icon: <UnorderedListOutlined />, label: 'Video Jobs' },
  { key: '/steam-games', icon: <AppstoreOutlined />, label: 'App Games' },
  { key: '/users', icon: <TeamOutlined />, label: 'Users' },
  { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
  { key: '/price-region-settings', icon: <SettingOutlined />, label: 'Price & Region' },
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
      <Sider breakpoint="lg" collapsedWidth={0}>
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
