import dotenv from 'dotenv';
import os from 'os';
import path from 'path';

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export type Env = {
  /** 逗号分隔；不设置则允许任意来源（开发默认） */
  corsOrigins?: string[];

  /** 本地或容器内 admin 构建目录；默认 <cwd>/admin/dist */
  adminDistPath: string;
  /** 为 false 时不挂载 /admin 静态与 SPA（仅 API） */
  serveAdminStatic: boolean;

  port: number;
  nodeEnv: string;
  jwtSecret: string;
  jwtExpiresIn: string;

  /** Admin dashboard (JWT separate from app users) */
  adminUsername: string;
  adminPassword: string;
  adminJwtSecret: string;
  adminJwtExpiresIn: string;

  /** Video pipeline */
  videoGcsBucket?: string;
  ffmpegPath: string;
  ffprobePath: string;
  ytDlpPath: string;
  videoTempDir: string;
  videoMaxDurationSec: number;
  videoTrimSec: number;
  videoSignedUrlMinutes: number;
  videoWorkerIntervalMs: number;

  /** May be empty if set only in Firestore runtime config */
  steamApiKey: string;
  steamOpenidRealm: string;
  steamOpenidReturnUrl: string;

  appDeeplinkScheme: string;
  appDeeplinkSuccessHost: string;
  appDeeplinkFailHost: string;
  appBaseUrl: string;
  /** Hints for mobile clients (also served via GET /api/config); tunable in admin runtime settings */
  appConnectTimeoutSec: number;
  appReceiveTimeoutSec: number;

  firebaseProjectId: string;
  googleApplicationCredentials?: string;

  steamHttpTimeoutMs: number;
  steamAutoSyncEnabled: boolean;
  steamAutoSyncIntervalMs: number;
  steamAutoSyncBatchSize: number;
  steamAutoSyncDelayMs: number;
};

export function loadEnv(): Env {
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isFinite(port) || port <= 0) throw new Error('Invalid PORT');

  const jwtSecret = required('JWT_SECRET');

  const corsRaw = process.env.CORS_ORIGINS?.trim();
  const corsOrigins = corsRaw
    ? corsRaw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : undefined;

  const adminDistPath = process.env.ADMIN_DIST_PATH?.trim()
    ? path.resolve(process.env.ADMIN_DIST_PATH)
    : path.join(process.cwd(), 'admin', 'dist');

  const serveAdminStatic = process.env.SERVE_ADMIN_STATIC !== 'false';

  return {
    corsOrigins,
    adminDistPath,
    serveAdminStatic,

    port,
    nodeEnv: process.env.NODE_ENV ?? 'development',
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',

    steamApiKey: process.env.STEAM_API_KEY?.trim() ?? '',
    // 兼容两套命名：STEAM_OPENID_*（旧）与 STEAM_*（新）
    steamOpenidRealm:
      process.env.STEAM_REALM?.trim() ||
      process.env.STEAM_OPENID_REALM?.trim() ||
      process.env.APP_BASE_URL?.trim() ||
      'http://localhost:8080',
    steamOpenidReturnUrl:
      process.env.STEAM_RETURN_URL?.trim() ||
      process.env.STEAM_OPENID_RETURN_URL?.trim() ||
      `${(process.env.APP_BASE_URL?.trim() || 'http://localhost:8080').replace(/\/$/, '')}/auth/steam/callback`,

    // 兼容两套命名：APP_DEEP_LINK_*（新）与 APP_DEEPLINK_SCHEME（旧）
    appDeeplinkScheme: process.env.APP_DEEP_LINK_SCHEME ?? process.env.APP_DEEPLINK_SCHEME ?? 'myapp',
    appDeeplinkSuccessHost: process.env.APP_DEEP_LINK_SUCCESS_HOST ?? 'auth',
    appDeeplinkFailHost: process.env.APP_DEEP_LINK_FAIL_HOST ?? 'auth',
    appBaseUrl: process.env.APP_BASE_URL?.trim() || 'http://localhost:8080',

    firebaseProjectId: required('FIREBASE_PROJECT_ID'),
    googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,

    steamHttpTimeoutMs: Number(process.env.STEAM_HTTP_TIMEOUT_MS ?? 8000),
    steamAutoSyncEnabled: process.env.STEAM_AUTO_SYNC_ENABLED === 'true',
    steamAutoSyncIntervalMs: Number(process.env.STEAM_AUTO_SYNC_INTERVAL_MS ?? 3600000),
    steamAutoSyncBatchSize: Number(process.env.STEAM_AUTO_SYNC_BATCH_SIZE ?? 200),
    steamAutoSyncDelayMs: Number(process.env.STEAM_AUTO_SYNC_DELAY_MS ?? 120),

    adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
    adminPassword: process.env.ADMIN_PASSWORD ?? '',
    adminJwtSecret: process.env.ADMIN_JWT_SECRET ?? jwtSecret,
    adminJwtExpiresIn: process.env.ADMIN_JWT_EXPIRES_IN ?? '12h',

    videoGcsBucket: process.env.VIDEO_GCS_BUCKET?.trim() || undefined,
    ffmpegPath: process.env.FFMPEG_PATH ?? 'ffmpeg',
    ffprobePath: process.env.FFPROBE_PATH ?? 'ffprobe',
    ytDlpPath: process.env.YTDLP_PATH ?? 'yt-dlp',
    videoTempDir: process.env.VIDEO_TEMP_DIR ?? os.tmpdir(),
    videoMaxDurationSec: Number(process.env.VIDEO_MAX_DURATION_SEC ?? 180),
    videoTrimSec: Number(process.env.VIDEO_TRIM_SEC ?? 30),
    videoSignedUrlMinutes: Number(process.env.VIDEO_SIGNED_URL_MINUTES ?? 60),
    videoWorkerIntervalMs: Number(process.env.VIDEO_WORKER_INTERVAL_MS ?? 10000),

    appConnectTimeoutSec: Number(process.env.APP_CONNECT_TIMEOUT_SEC ?? 15),
    appReceiveTimeoutSec: Number(process.env.APP_RECEIVE_TIMEOUT_SEC ?? 90),
  };
}

