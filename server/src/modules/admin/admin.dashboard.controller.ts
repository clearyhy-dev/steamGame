import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { sendAdminOk } from '../../utils/adminJson';
import { VideoAdminService } from '../video/video-admin.service';

export class AdminDashboardController {
  constructor(private env: Env) {}

  stats = async (_req: Request, res: Response): Promise<void> => {
    const svc = new VideoAdminService(this.env);
    const data = await svc.dashboardStats();
    sendAdminOk(res, data);
  };
}
