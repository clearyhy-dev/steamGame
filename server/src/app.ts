import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Env } from './config/env';
import { createRouter } from './routes';
import { errorMiddleware } from './middlewares/error.middleware';
import { mountAdminUiIfEnabled } from './middlewares/adminStatic.middleware';

export function createApp(env: Env) {
  const app = express();

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          // Admin 页面需要展示 Steam/CDN 外链图与视频资源
          'img-src': ["'self'", 'data:', 'https:'],
          'media-src': ["'self'", 'data:', 'https:'],
          'connect-src': ["'self'", 'https:'],
        },
      },
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

  // Admin 静态页挂在 API 之前，避免与其它路由混淆；镜像内需含 admin/dist（见仓库根 Dockerfile）
  mountAdminUiIfEnabled(app, env);

  app.use(createRouter(env));

  app.use(errorMiddleware);

  return app;
}

