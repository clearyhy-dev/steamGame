import type { Request, Response } from 'express';
import type { AuthEnv } from './env';
import { SteamOpenIdService } from './steam-openid';
import { fetchSteamPlayerSummaries } from './steam-api';
import { signAuthToken, verifyAuthToken } from './jwt';

type SteamLoginMode = 'login' | 'bind';

function deepLink(env: AuthEnv, host: string, path: string, params: Record<string, string>) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${env.appDeeplinkScheme}://${host}${normalizedPath}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function buildUserIdForSteam(steamId: string): string {
  return `u_${steamId}`;
}

export class AuthController {
  private openid = new SteamOpenIdService();

  constructor(private env: AuthEnv) {}

  startSteam = (req: Request, res: Response): void => {
    const modeRaw = String(req.query.mode ?? 'login').toLowerCase();
    const mode: SteamLoginMode = modeRaw === 'bind' ? 'bind' : 'login';
    const returnUrl = new URL(this.env.steamOpenidReturnUrl);
    returnUrl.searchParams.set('mode', mode);
    if (mode === 'bind') {
      const appUserId = String(req.query.appUserId ?? '').trim();
      if (!appUserId) {
        res.status(400).json({ success: false, message: 'Missing appUserId for bind mode' });
        return;
      }
      returnUrl.searchParams.set('appUserId', appUserId);
      const appEmail = String(req.query.appEmail ?? '').trim();
      const appPhotoUrl = String(req.query.appPhotoUrl ?? '').trim();
      if (appEmail) returnUrl.searchParams.set('appEmail', appEmail);
      if (appPhotoUrl) returnUrl.searchParams.set('appPhotoUrl', appPhotoUrl);
    }
    returnUrl.searchParams.set('state', Math.random().toString(16).slice(2));
    res.redirect(302, this.openid.buildLoginRedirectUrl(this.env, returnUrl.toString()));
  };

  callbackSteam = async (req: Request, res: Response): Promise<void> => {
    try {
      const steamId = await this.openid.verifyCallbackAndExtractSteamId(this.env, req.query as Record<string, string>);
      const modeRaw = String(req.query.mode ?? 'login').toLowerCase();
      const mode: SteamLoginMode = modeRaw === 'bind' ? 'bind' : 'login';
      const profiles = await fetchSteamPlayerSummaries(this.env, [steamId]);
      const profile = profiles[0];
      if (!profile?.personaName) throw new Error('Steam profile not found');

      let userId: string;
      let authProviders: string[];
      let email = '';
      let avatarUrl = profile.avatarFull || profile.avatar || '';

      if (mode === 'bind') {
        userId = String(req.query.appUserId ?? '').trim();
        if (!userId) throw new Error('Missing appUserId for bind');
        authProviders = ['google', 'steam'];
        email = String(req.query.appEmail ?? '').trim();
        const appPhotoUrl = String(req.query.appPhotoUrl ?? '').trim();
        if (appPhotoUrl) avatarUrl = appPhotoUrl;
      } else {
        userId = buildUserIdForSteam(steamId);
        authProviders = ['steam'];
      }

      const token = signAuthToken(
        {
          userId,
          steamId,
          displayName: profile.personaName,
          email,
          avatarUrl,
          authProviders,
        },
        this.env,
      );

      res.redirect(
        302,
        deepLink(this.env, this.env.appDeeplinkSuccessHost, '/steam/success', { token }),
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      res.redirect(
        302,
        deepLink(this.env, this.env.appDeeplinkFailHost, '/steam/fail', { reason }),
      );
    }
  };

  introspect = (req: Request, res: Response): void => {
    const secret = String(req.header('x-service-secret') ?? '').trim();
    if (!secret || secret !== this.env.introspectServiceSecret) {
      res.status(401).json({ active: false, message: 'unauthorized' });
      return;
    }
    const token = String(req.body?.token ?? '').trim();
    if (!token) {
      res.status(400).json({ active: false, message: 'missing token' });
      return;
    }
    const claims = verifyAuthToken(token, this.env);
    if (!claims) {
      res.json({ active: false });
      return;
    }
    res.json({
      active: true,
      userId: claims.userId,
      steamId: claims.steamId,
      displayName: claims.displayName ?? '',
      email: claims.email ?? '',
      avatarUrl: claims.avatarUrl ?? '',
      authProviders: claims.authProviders,
    });
  };

  health = (_req: Request, res: Response): void => {
    res.json({ success: true, service: 'steamgame-auth' });
  };
}
