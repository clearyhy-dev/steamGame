import type { Request, Response } from 'express';
import { ApiError } from '../../utils/apiError';
import type { Env } from '../../config/env';
import { SteamOpenIdService } from '../steam/steam.openid.service';
import { SteamService } from '../steam/steam.service';
import { AuthService, type SteamLoginMode } from './auth.service';
import type { AuthedRequest } from '../../middlewares/auth.middleware';
import { getEffectiveEnv } from '../../config/runtime-config';

function deepLink(env: Env, host: string, path: string, params: Record<string, string>) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${env.appDeeplinkScheme}://${host}${normalizedPath}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export class AuthController {
  private openid: SteamOpenIdService;
  private steam: SteamService;
  private auth: AuthService;

  constructor(private env: Env) {
    this.openid = new SteamOpenIdService();
    this.steam = new SteamService(env);
    this.auth = new AuthService(env);
  }

  startSteam = async (req: Request, res: Response) => {
    const e = await getEffectiveEnv(this.env);
    const modeRaw = String(req.query.mode ?? 'login').toLowerCase();
    const mode: SteamLoginMode = modeRaw === 'bind' ? 'bind' : 'login';

    const returnUrl = new URL(e.steamOpenidReturnUrl);
    returnUrl.searchParams.set('mode', mode);

    if (mode === 'bind') {
      const appUserId = String(req.query.appUserId ?? '');
      const appEmail = String(req.query.appEmail ?? '');
      const appPhotoUrl = String(req.query.appPhotoUrl ?? '');

      if (!appUserId) throw new ApiError(400, 'BAD_REQUEST', 'Missing appUserId for bind mode');
      returnUrl.searchParams.set('appUserId', appUserId);
      if (appEmail) returnUrl.searchParams.set('appEmail', appEmail);
      if (appPhotoUrl) returnUrl.searchParams.set('appPhotoUrl', appPhotoUrl);
    }

    // Optional random state to avoid accidental mix-ups (kept as return_to param).
    returnUrl.searchParams.set('state', cryptoRandomState());

    const redirectUrl = this.openid.buildLoginRedirectUrl(e, returnUrl.toString());
    res.redirect(302, redirectUrl);
  };

  callbackSteam = async (req: Request, res: Response) => {
    const e = await getEffectiveEnv(this.env);
    try {
      const steamId = await this.openid.verifyCallbackAndExtractSteamId(e, req.query as any);

      const modeRaw = String(req.query.mode ?? 'login').toLowerCase();
      const mode: SteamLoginMode = modeRaw === 'bind' ? 'bind' : 'login';

      const appUserId = mode === 'bind' ? String(req.query.appUserId ?? '') : undefined;
      const appEmail = mode === 'bind' ? String(req.query.appEmail ?? '') : undefined;
      const appPhotoUrl = mode === 'bind' ? String(req.query.appPhotoUrl ?? '') : undefined;

      const profiles = await this.steam.getPlayerSummaries([steamId]);
      const profile = profiles[0];
      if (!profile) throw new ApiError(401, 'STEAM_LOGIN_FAILED', 'Steam profile not found');
      if (!profile.personaName) throw new ApiError(401, 'STEAM_LOGIN_FAILED', 'Steam persona name missing');

      const result = await this.auth.loginOrBindSteam({
        mode,
        steamId,
        appUserId,
        appEmail,
        appPhotoUrl,
        steamProfile: profile,
      });

      res.redirect(
        302,
        deepLink(e, e.appDeeplinkSuccessHost, '/steam/success', {
          token: result.token,
        }),
      );
    } catch (err: any) {
      const reason = err instanceof ApiError ? err.message : String(err?.message ?? err);
      res.redirect(
        302,
        deepLink(e, e.appDeeplinkFailHost, '/steam/fail', {
          reason,
        }),
      );
    }
  };

  bindSteam = async (req: AuthedRequest, res: Response) => {
    const userId = req.auth?.userId;
    if (!userId) throw new ApiError(401, 'UNAUTHORIZED', 'Missing auth context');
    const steamId = String((req.body?.steamId ?? '').toString());
    if (!steamId) throw new ApiError(400, 'BAD_REQUEST', 'Missing steamId');

    const profiles = await this.steam.getPlayerSummaries([steamId]);
    const profile = profiles[0];
    if (!profile) throw new ApiError(401, 'STEAM_LOGIN_FAILED', 'Steam profile not found');

    const result = await this.auth.bindSteamToAuthenticatedUser({
      userId,
      steamId,
      steamProfile: profile,
    });

    res.json({ success: true, data: { token: result.token } });
  };

  logout = async (_req: AuthedRequest, res: Response) => {
    // Stateless JWT: client should just drop token.
    res.json({ success: true, data: { ok: true } });
  };
}

function cryptoRandomState() {
  // eslint-disable-next-line no-undef
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

