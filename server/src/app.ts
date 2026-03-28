import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import type { Env } from './config/env';
import { createRouter } from './routes';
import { errorMiddleware } from './middlewares/error.middleware';

export function createApp(_env: Env) {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));

  // 必须在业务 Router 之前注册。Cloud Run 保留「以 z 结尾」的路径，/healthz 无法到达容器（见官方 known-issues）。
  app.get('/health', (_req, res) => res.status(200).json({ success: true, data: 'ok' }));

  app.use(createRouter(_env));

  app.use(errorMiddleware);

  return app;
}

