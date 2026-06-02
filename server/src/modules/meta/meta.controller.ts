import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { getEffectiveEnv } from '../../config/runtime-config';
import { listKnownEndpoints } from './endpoint-catalog';

export type { EndpointRow, EndpointAudience } from './endpoint-types';

/**
 * Diagnostics metadata for clients / admins.
 * Note: this is intentionally **read-only** metadata for troubleshooting.
 * Do NOT make endpoint paths dynamically configurable.
 */
export class MetaController {
  constructor(private env: Env) {}

  endpoints = async (_req: Request, res: Response): Promise<void> => {
    const e = await getEffectiveEnv(this.env);
    const apiBaseUrl = String(e.appBaseUrl ?? '').trim().replace(/\/+$/, '');

    const endpoints = listKnownEndpoints();

    res.status(200).json({
      success: true,
      data: {
        apiBaseUrl,
        generatedAt: new Date().toISOString(),
        endpoints,
      },
    });
  };
}
