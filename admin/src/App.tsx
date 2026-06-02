import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { getToken } from './api/client';
import { AdminLayout } from './layouts/AdminLayout';
import { DashboardPage } from './pages/DashboardPage';
import { LoginPage } from './pages/LoginPage';
import { VideoDetailPage } from './pages/VideoDetailPage';
import { VideoJobsPage } from './pages/VideoJobsPage';
import { VideoSourcesPage } from './pages/VideoSourcesPage';
import { VideosPage } from './pages/VideosPage';
import { AppGamesLayout } from './pages/app-games/AppGamesLayout';
import { GamesDataPage } from './pages/app-games/GamesDataPage';
import { AppGamesCatalogSyncPage } from './pages/app-games/CatalogSyncPage';
import { AppGamesDetailSyncPage } from './pages/app-games/DetailSyncPage';
import { AppGamesDealSyncPage } from './pages/app-games/DealSyncPage';
import { AppGamesSyncResultsPage } from './pages/app-games/SyncResultsPage';
import { MarketGamesPage } from './pages/app-games/MarketGamesPage';
import { UsersPage } from './pages/UsersPage';
import { SettingsPage } from './pages/SettingsPage';
import { CountryRegionMappingPage } from './pages/CountryRegionMappingPage';
import { RequestLogsPage } from './pages/RequestLogsPage';
import { AppDiagnosticsPage } from './pages/AppDiagnosticsPage';
import { ScheduledTasksPage } from './pages/ScheduledTasksPage';
import { SqliteDatabasePage } from './pages/SqliteDatabasePage';

function RequireAuth() {
  if (!getToken()) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <ConfigProvider locale={zhCN}>
      <BrowserRouter basename="/admin">
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AdminLayout />}>
              <Route index element={<Navigate to="dashboard" replace />} />
              <Route path="dashboard" element={<DashboardPage />} />
              <Route path="video-sources" element={<VideoSourcesPage />} />
              <Route path="videos" element={<VideosPage />} />
              <Route path="videos/:videoId" element={<VideoDetailPage />} />
              <Route path="video-jobs" element={<VideoJobsPage />} />
              <Route path="app-games" element={<AppGamesLayout />}>
                <Route index element={<Navigate to="steam" replace />} />
                <Route path="steam" element={<GamesDataPage variant="steam" />} />
                <Route path="itad" element={<GamesDataPage variant="itad" />} />
                <Route path="gg" element={<GamesDataPage variant="gg" />} />
                <Route path="cheapshark" element={<GamesDataPage variant="cheapshark" />} />
                <Route path="worth-buy" element={<GamesDataPage variant="worthbuy" />} />
                <Route path="market" element={<MarketGamesPage />} />
                <Route path="list" element={<Navigate to="../steam" replace />} />
                <Route path="catalog-sync" element={<AppGamesCatalogSyncPage />} />
                <Route path="detail-sync" element={<AppGamesDetailSyncPage />} />
                <Route path="deal-sync" element={<AppGamesDealSyncPage />} />
                <Route path="sync-results" element={<AppGamesSyncResultsPage />} />
              </Route>
              <Route path="steam-games" element={<Navigate to="/app-games/steam" replace />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="scheduled-tasks" element={<ScheduledTasksPage />} />
              <Route path="sqlite-database" element={<SqliteDatabasePage />} />
              <Route path="app-diagnostics" element={<AppDiagnosticsPage />} />
              <Route path="request-logs" element={<RequestLogsPage />} />
              <Route path="country-region-mapping" element={<CountryRegionMappingPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}
