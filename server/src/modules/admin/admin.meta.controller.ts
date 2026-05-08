import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { MetaController } from '../meta/meta.controller';

/**
 * Admin wrapper for diagnostics metadata.
 * We wrap the public MetaController response into the admin `ok/data/message` envelope.
 */
export class AdminMetaController {
  private meta: MetaController;
  constructor(env: Env) {
    this.meta = new MetaController(env);
  }

  endpoints = async (req: Request, res: Response): Promise<void> => {
    // Call underlying handler and re-wrap response.
    // We can't easily reuse its json() call, so we compute the same payload by invoking a helper:
    // MetaController currently only exposes express handlers; simplest is to duplicate by calling it and capturing output,
    // but express doesn't provide a clean capture mechanism here. Instead, we re-implement minimal logic by calling meta.endpoints
    // into a temporary Response-like object.
    let payload: any = null;
    const fakeRes = {
      status: (_code: number) => fakeRes,
      json: (body: any) => {
        payload = body;
        return fakeRes;
      },
    } as unknown as Response;

    await this.meta.endpoints(req, fakeRes);
    const data = payload?.data ?? payload ?? null;
    res.status(200).json({ ok: true, data, message: null });
  };
}

