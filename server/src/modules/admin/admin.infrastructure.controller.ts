import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { sendAdminOk } from '../../utils/adminJson';
import {
  browseMinio,
  browseRedis,
  buildInfrastructureConfig,
  rebuildPriceSyncIndex,
} from './infrastructure.service';

export class AdminInfrastructureController {
  constructor(private env: Env) {}

  getConfig = async (_req: Request, res: Response): Promise<void> => {
    sendAdminOk(res, await buildInfrastructureConfig(this.env));
  };

  rebuildPriceSyncIndex = async (_req: Request, res: Response): Promise<void> => {
    const data = await rebuildPriceSyncIndex(this.env);
    sendAdminOk(res, data);
  };

  browseMinio = async (req: Request, res: Response): Promise<void> => {
    const prefix = typeof req.query.prefix === 'string' ? req.query.prefix : '';
    const limit = req.query.limit != null ? Number(req.query.limit) : 50;
    const data = await browseMinio(this.env, { prefix, limit });
    sendAdminOk(res, data);
  };

  browseRedis = async (_req: Request, res: Response): Promise<void> => {
    const data = await browseRedis(this.env);
    sendAdminOk(res, data);
  };
}
