import type { Request, Response } from 'express';
import type { Env } from '../../config/env';
import type { AuthedRequest } from '../../middlewares/auth.middleware';
import { ApiError } from '../../utils/apiError';
import { sendSuccess } from '../../utils/apiResponse';
import { RecommendationsService } from './recommendations.service';

function normalizeCountryQuery(q: unknown): string {
  const s = String(q ?? 'US')
    .trim()
    .toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? s : 'US';
}

function normalizeLanguageQuery(q: unknown): string | undefined {
  const raw = Array.isArray(q) ? q[0] : q;
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return undefined;
  return /^[a-z]{2}(-[a-z]{2})?$/.test(s) ? s : undefined;
}

export class RecommendationsController {
  private svc: RecommendationsService;

  constructor(env: Env) {
    this.svc = new RecommendationsService(env);
  }

  home = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const country = normalizeCountryQuery(req.query.country);
    const language =
      normalizeLanguageQuery(req.query.language) ??
      normalizeLanguageQuery(req.query.l) ??
      normalizeLanguageQuery(req.query.ui);
    const data = await this.svc.getHomeRecommendations(userId, country, language);
    return sendSuccess(res, data);
  };

  explore = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const tab = String(req.query.tab ?? 'trending');
    const country = normalizeCountryQuery(req.query.country);
    const language =
      normalizeLanguageQuery(req.query.language) ??
      normalizeLanguageQuery(req.query.l) ??
      normalizeLanguageQuery(req.query.ui);
    const data = await this.svc.getExplore(userId, tab, country, language);
    return sendSuccess(res, data);
  };

  /** No auth: deal pool + Steam regional prices (no library/recent personalization). */
  trendingPublic = async (req: Request, res: Response) => {
    const country = normalizeCountryQuery(req.query.country);
    const language =
      normalizeLanguageQuery(req.query.language) ??
      normalizeLanguageQuery(req.query.l) ??
      normalizeLanguageQuery(req.query.ui);
    const data = await this.svc.getTrendingPublic(country, language);
    return sendSuccess(res, data);
  };
}
