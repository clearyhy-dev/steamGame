import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import { sendAdminFail, sendAdminOk } from '../../utils/adminJson';
import { VideoJobRepository } from '../video/video-job.repository';
import { VideoAdminService } from '../video/video-admin.service';
import { serializeVideoJob } from '../video/video.serializer';
import type { JobStatus } from '../video/video.types';

export class AdminVideoJobsController {
  constructor(
    private env: Env,
    private repo = new VideoJobRepository(),
    private adminSvc = new VideoAdminService(env),
  ) {}

  list = async (req: Request, res: Response): Promise<void> => {
    const status = req.query.status as JobStatus | undefined;
    const rows = await this.repo.list({ status });
    sendAdminOk(res, rows.map(serializeVideoJob));
  };

  retry = async (req: Request, res: Response): Promise<void> => {
    try {
      await this.adminSvc.retryJob(req.params.jobId);
      sendAdminOk(res, { jobId: req.params.jobId });
    } catch (e) {
      sendAdminFail(res, 400, e instanceof Error ? e.message : String(e));
    }
  };
}
