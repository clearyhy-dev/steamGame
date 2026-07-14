import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Env } from './config/env';
import { createRouter } from './routes';
import { errorMiddleware } from './middlewares/error.middleware';
import { mountAdminUiIfEnabled } from './middlewares/adminStatic.middleware';
import { requestLogMiddleware } from './middlewares/request-log.middleware';

export function createApp(env: Env) {
  const app = express();
  const httpsSite = env.appBaseUrl.startsWith('https://');

  app.use(
    helmet({
      // 纯 HTTP 部署（如 Vultr IP:8080）时勿升级资源到 HTTPS，否则 Admin JS 会 ERR_SSL_PROTOCOL_ERROR
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'img-src': ["'self'", 'data:', 'https:', 'http:'],
          'media-src': ["'self'", 'data:', 'https:', 'http:'],
          'connect-src': ["'self'", 'https:', 'http:'],
          ...(httpsSite ? {} : { 'upgrade-insecure-requests': null }),
        },
      },
      crossOriginOpenerPolicy: httpsSite ? undefined : false,
      crossOriginResourcePolicy: httpsSite ? undefined : { policy: 'cross-origin' },
      strictTransportSecurity: httpsSite ? undefined : false,
    }),
  );

  if (env.corsOrigins?.length) {
    app.use(
      cors({
        origin: env.corsOrigins,
        credentials: true,
      }),
    );
  } else {
    app.use(cors());
  }

  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 必须在业务 Router 之前注册。Cloud Run 保留「以 z 结尾」的路径，/healthz 无法到达容器（见官方 known-issues）。
  app.get('/health', (_req, res) => res.status(200).json({ success: true, data: 'ok' }));

  // 先于 Admin 静态：/admin 与 /v1 等统一落请求日志（静态资源在中间件内跳过）
  app.use(requestLogMiddleware(env));

  // Admin 静态页挂在 API 之前，避免与其它路由混淆；镜像内需含 admin/dist（见仓库根 Dockerfile）
  mountAdminUiIfEnabled(app, env);

  app.use(createRouter(env));

  app.use(errorMiddleware);

  return app;
}

