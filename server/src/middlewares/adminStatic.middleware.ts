import express from 'express';
import fs from 'fs';
import path from 'path';
import type { Env } from '../config/env';
import { logger } from '../utils/logger';

/** 挂载 Vite 构建的后台 SPA：静态资源 + History fallback */
export function mountAdminUiIfEnabled(app: express.Application, env: Env): void {
  if (!env.serveAdminStatic) {
    logger.info('SERVE_ADMIN_STATIC=false: skipping /admin UI mount');
    return;
  }

  const dir = env.adminDistPath;
  if (!fs.existsSync(dir)) {
    logger.warn(`Admin dist not found (${dir}); set ADMIN_DIST_PATH or build admin/. Run without UI or SERVE_ADMIN_STATIC=false.`);
    return;
  }

  logger.info(`Serving admin SPA from ${dir}`);

  app.use('/admin', express.static(dir, { fallthrough: true, index: false }));

  app.use('/admin', (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return next();
    }
    res.sendFile(path.join(dir, 'index.html'));
  });
}
