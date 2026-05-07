import type { NextFunction, Request, Response } from 'express';
import type { Env } from '../config/env';
import { verifyJwt } from '../config/jwt';
import { logger } from '../utils/logger';
import { RequestLogRepository } from '../modules/observability/request-log.repository';

const repo = new RequestLogRepository();

function pickIp(req: Request): string | undefined {
  const xff = req.header('x-forwarded-for');
  if (xff) return xff.split(',')[0]?.trim();
  return req.ip || undefined;
}

function resolveUserId(req: Request, env: Env): string | undefined {
  const header = req.header('Authorization');
  if (!header || !header.startsWith('Bearer ')) return undefined;
  const token = header.substring('Bearer '.length).trim();
  try {
    const payload = verifyJwt(token, env);
    return payload.userId;
  } catch {
    return undefined;
  }
}

/** 跳过高频静态资源，避免把 Firestore 写爆；SPA 路由（无扩展名）仍会记录。 */
const STATIC_ASSET_PATH_RE = /\.(js|mjs|cjs|css|map|png|jpe?g|gif|svg|ico|woff2?|ttf|eot|json|webp|avif)$/i;

function shouldSkipLogging(req: Request, pathname: string): boolean {
  if (pathname === '/health' || pathname === '/favicon.ico') return true;
  const m = req.method.toUpperCase();
  if ((m === 'GET' || m === 'HEAD') && STATIC_ASSET_PATH_RE.test(pathname)) return true;
  return false;
}

function requestPathname(req: Request): string {
  const raw = String(req.originalUrl ?? req.url ?? req.path ?? '');
  const q = raw.indexOf('?');
  return (q >= 0 ? raw.slice(0, q) : raw) || req.path || '/';
}

export function requestLogMiddleware(env: Env) {
  return (req: Request, res: Response, next: NextFunction) => {
    const pathname = requestPathname(req);
    if (shouldSkipLogging(req, pathname)) return next();

    const startedAt = Date.now();
    const requestId = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const userId = resolveUserId(req, env);

    let ended = false;
    const schedulePersist = () => {
      if (ended) return;
      ended = true;

      const durationMs = Date.now() - startedAt;
      const query: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.query ?? {})) {
        if (v == null) continue;
        query[k] = Array.isArray(v) ? String(v[0] ?? '') : String(v);
      }

      const bodyKeys =
        req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? Object.keys(req.body).slice(0, 30) : [];

      const errorCodeHeader = res.getHeader('x-error-code');
      const errorCode = typeof errorCodeHeader === 'string' ? errorCodeHeader : undefined;

      const ua = req.header('user-agent');
      const ref = req.header('referer');

      // 下一事件循环再写 Firestore，避免与响应收尾抢同一线程；失败不影响业务。
      setImmediate(() => {
        void repo
          .writeLog({
            requestId,
            method: req.method,
            path: pathname,
            statusCode: res.statusCode,
            durationMs,
            userId,
            ip: pickIp(req),
            userAgent: ua?.trim() ? ua : undefined,
            referer: ref?.trim() ? ref : undefined,
            query: Object.keys(query).length ? query : undefined,
            bodyKeys: bodyKeys.length ? bodyKeys : undefined,
            errorCode,
            createdAt: new Date(),
          })
          .catch((e) => {
            logger.warn(`[request-log] failed to persist: ${e instanceof Error ? e.message : String(e)}`);
          });
      });
    };

    res.on('finish', schedulePersist);
    res.on('close', schedulePersist);

    next();
  };
}
