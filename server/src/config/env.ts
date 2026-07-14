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
  /** 公开 JSON 缓存（如 `cache/top-discounts-us.json`）；未设时可回退为 VIDEO_GCS_BUCKET */
  gcsCacheBucket?: string;
  /** `gcs` 或 `s3`（MinIO / Vultr / R2 等 S3 兼容）；`r2` 视为 `s3` */
  cacheUploadBackend: 'gcs' | 's3';
  s3Endpoint?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3Bucket?: string;
  /** R2 / S3 兼容 endpoint，如 `https://<accountid>.r2.cloudflarestorage.com` */
  r2Endpoint?: string;
  r2AccessKeyId?: string;
  r2SecretAccessKey?: string;
  r2CacheBucket?: string;
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
  /**
   * 可选：公开静态 JSON（GCS/Cloud CDN）根 URL，无尾斜杠；客户端优先拉 `.../cache/*.json`。
   * 例：`https://storage.googleapis.com/<bucket>` 或自有 CDN 域名。
   */
  publicCacheCdnBase?: string;
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
  requestLogRetentionDays: number;
  /**
   * 非空时开放内部 Cron（Header: X-Cron-Secret）：`POST /api/internal/cron/daily-schedules`（全部已启用计划任务，刷新 lastRun 状态）、
   * `POST /api/internal/cron/daily-deal-schedules`（仅折扣类）、
   * `POST /api/internal/cron/daily-deals`（单任务 Top1000 四渠道）、
   * `POST /api/internal/cron/weekly-heat`（周在线人数 → `game_weekly_heat`）、
   * `POST /api/internal/cron/build-cache`（写入 `cache/*.json`：默认 GCS，或 `CACHE_UPLOAD_BACKEND=r2` 时写 R2）。
   */
  cronSecret: string;
  /**
   * 折扣分桶持久化：`firestore`（默认，`game_discount_offers`）或 `object_storage`（GCS/R2 上 `cache/discount-offers/v1/*.json`，无 Firestore 写入）。
   */
  discountOffersPersistence: 'firestore' | 'object_storage';
  /** 折扣「今日」日历 IANA 时区，默认 Asia/Shanghai */
  dealSyncPriceDayTz: string;
  /** false：不启动定时任务 cron、视频 worker；「立即运行」亦拒绝（省 Cloud Run / 外部 API 费用） */
  backgroundWorkersEnabled: boolean;
  /** firestore=GCP Firestore；vultr_sqlite=Vultr SQLite Data API（停 Firestore 计费） */
  dataStore: 'firestore' | 'vultr_sqlite';
  sqliteApiUrl?: string;
  sqliteApiSecret?: string;
  /** false 时不写入 api_request_logs（省存储） */
  requestLogEnabled: boolean;
  /** GCP Auth 服务 URL（Token 内省） */
  authServiceUrl?: string;
  authIntrospectSecret?: string;
  /** true：Steam OpenID 由 GCP Auth 处理 */
  authOnGcp: boolean;
  jwtIssuer: string;

  /** Pro wishlist email (SMTP) */
  smtpHost?: string;
  smtpPort: number;
  smtpUser?: string;
  smtpPass?: string;
  mailFrom?: string;
  mailFromName?: string;
};

export function loadEnv(): Env {
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isFinite(port) || port <= 0) throw new Error('Invalid PORT');

  const jwtSecret = required('JWT_SECRET');
  const env = buildEnv(jwtSecret, port);
  validateEnv(env);
  return env;
}

function buildEnv(jwtSecret: string, port: number): Env {

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

  const rawBackend = (process.env.CACHE_UPLOAD_BACKEND ?? 's3').trim().toLowerCase();
  const cacheUploadBackend: 'gcs' | 's3' =
    rawBackend === 'gcs' ? 'gcs' : 's3';

  const rawDiscountPersist = (process.env.DISCOUNT_OFFERS_PERSISTENCE ?? 'object_storage').trim().toLowerCase();
  const discountOffersPersistence: 'firestore' | 'object_storage' =
    rawDiscountPersist === 'object_storage' ? 'object_storage' : 'firestore';

  const rawDataStore = (process.env.DATA_STORE ?? 'vultr_sqlite').trim().toLowerCase();
  const dataStore: 'firestore' | 'vultr_sqlite' =
    rawDataStore === 'firestore' ? 'firestore' : 'vultr_sqlite';

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
    publicCacheCdnBase: process.env.PUBLIC_CACHE_CDN_BASE?.trim().replace(/\/+$/, '') || undefined,

    firebaseProjectId: process.env.FIREBASE_PROJECT_ID?.trim() || 'steamdeal',
    googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
    dataStore,
    sqliteApiUrl: process.env.SQLITE_API_URL?.trim().replace(/\/+$/, '') || undefined,
    sqliteApiSecret: process.env.SQLITE_API_SECRET?.trim() || undefined,
    requestLogEnabled:
      process.env.REQUEST_LOG_ENABLED != null
        ? process.env.REQUEST_LOG_ENABLED !== 'false'
        : dataStore === 'firestore',

    steamHttpTimeoutMs: Number(process.env.STEAM_HTTP_TIMEOUT_MS ?? 8000),
    steamAutoSyncEnabled: process.env.STEAM_AUTO_SYNC_ENABLED === 'true',
    steamAutoSyncIntervalMs: Number(process.env.STEAM_AUTO_SYNC_INTERVAL_MS ?? 3600000),
    steamAutoSyncBatchSize: Number(process.env.STEAM_AUTO_SYNC_BATCH_SIZE ?? 200),
    steamAutoSyncDelayMs: Number(process.env.STEAM_AUTO_SYNC_DELAY_MS ?? 120),
    requestLogRetentionDays: Number(process.env.REQUEST_LOG_RETENTION_DAYS ?? 14),
    cronSecret: process.env.CRON_SECRET?.trim() ?? '',

    adminUsername: process.env.ADMIN_USERNAME ?? 'admin',
    adminPassword: process.env.ADMIN_PASSWORD ?? '',
    adminJwtSecret: process.env.ADMIN_JWT_SECRET ?? jwtSecret,
    adminJwtExpiresIn: process.env.ADMIN_JWT_EXPIRES_IN ?? '12h',

    videoGcsBucket: process.env.VIDEO_GCS_BUCKET?.trim() || undefined,
    gcsCacheBucket: process.env.GCS_CACHE_BUCKET?.trim() || undefined,
    cacheUploadBackend,
    discountOffersPersistence,
    dealSyncPriceDayTz:
      process.env.DEAL_SYNC_PRICE_DAY_TZ?.trim() || 'Asia/Shanghai',
    s3Endpoint:
      process.env.S3_ENDPOINT?.trim().replace(/\/+$/, '') ||
      process.env.R2_ENDPOINT?.trim().replace(/\/+$/, '') ||
      undefined,
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID?.trim() || process.env.R2_ACCESS_KEY_ID?.trim() || undefined,
    s3SecretAccessKey:
      process.env.S3_SECRET_ACCESS_KEY?.trim() || process.env.R2_SECRET_ACCESS_KEY?.trim() || undefined,
    s3Bucket:
      process.env.S3_BUCKET?.trim() ||
      process.env.R2_CACHE_BUCKET?.trim() ||
      process.env.GCS_CACHE_BUCKET?.trim() ||
      undefined,
    r2Endpoint: process.env.R2_ENDPOINT?.trim().replace(/\/+$/, '') || undefined,
    r2AccessKeyId: process.env.R2_ACCESS_KEY_ID?.trim() || undefined,
    r2SecretAccessKey: process.env.R2_SECRET_ACCESS_KEY?.trim() || undefined,
    r2CacheBucket: process.env.R2_CACHE_BUCKET?.trim() || undefined,
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

    backgroundWorkersEnabled: process.env.BACKGROUND_WORKERS_ENABLED !== 'false',
    authServiceUrl: process.env.AUTH_SERVICE_URL?.trim().replace(/\/+$/, '') || undefined,
    authIntrospectSecret: process.env.AUTH_INTROSPECT_SECRET?.trim() || undefined,
    authOnGcp: process.env.AUTH_ON_GCP !== 'false',
    jwtIssuer: process.env.JWT_ISSUER?.trim() || 'steamgame-api',

    smtpHost: process.env.SMTP_HOST?.trim() || undefined,
    smtpPort: Number(process.env.SMTP_PORT ?? 587),
    smtpUser: process.env.SMTP_USER?.trim() || undefined,
    smtpPass: process.env.SMTP_PASS?.trim() || undefined,
    mailFrom: process.env.MAIL_FROM?.trim() || undefined,
    mailFromName: process.env.MAIL_FROM_NAME?.trim() || undefined,
  };
}

function validateEnv(env: Env): void {
  if (env.dataStore === 'vultr_sqlite' && !env.sqliteApiUrl) {
    throw new Error('DATA_STORE=vultr_sqlite requires SQLITE_API_URL (Vultr data-api, e.g. http://HOST:8090)');
  }
  if (env.dataStore === 'vultr_sqlite' && env.discountOffersPersistence !== 'object_storage') {
    throw new Error(
      'DATA_STORE=vultr_sqlite requires DISCOUNT_OFFERS_PERSISTENCE=object_storage (MinIO on Vultr, not Firestore)',
    );
  }
  if (env.dataStore === 'vultr_sqlite' && env.cacheUploadBackend !== 's3') {
    throw new Error('DATA_STORE=vultr_sqlite requires CACHE_UPLOAD_BACKEND=s3 (Vultr MinIO)');
  }
  if (env.dataStore === 'firestore' && !process.env.FIREBASE_PROJECT_ID?.trim()) {
    throw new Error('DATA_STORE=firestore requires FIREBASE_PROJECT_ID');
  }
}

