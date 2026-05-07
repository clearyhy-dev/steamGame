import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { getToken } from "./api/client";
import { AdminLayout } from "./layouts/AdminLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { VideoDetailPage } from "./pages/VideoDetailPage";
import { VideoJobsPage } from "./pages/VideoJobsPage";
import { VideoSourcesPage } from "./pages/VideoSourcesPage";
import { VideosPage } from "./pages/VideosPage";
import { SteamGamesPage } from "./pages/SteamGamesPage";
import { UsersPage } from "./pages/UsersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PriceRegionSettingsPage } from "./pages/PriceRegionSettingsPage";
import { CountryRegionMappingPage } from "./pages/CountryRegionMappingPage";
import { YouTubeVideoPage } from "./pages/YouTubeVideoPage";

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
              <Route path="steam-games" element={<SteamGamesPage />} />
              <Route path="users" element={<UsersPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="price-region-settings" element={<PriceRegionSettingsPage />} />
              <Route path="country-region-mapping" element={<CountryRegionMappingPage />} />
              <Route path="youtube-videos" element={<YouTubeVideoPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}
