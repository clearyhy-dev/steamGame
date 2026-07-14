import dotenv from 'dotenv';

dotenv.config();

export type AuthEnv = {
  port: number;
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtIssuer: string;
  introspectServiceSecret: string;
  steamApiKey: string;
  steamOpenidRealm: string;
  steamOpenidReturnUrl: string;
  appDeeplinkScheme: string;
  appDeeplinkSuccessHost: string;
  appDeeplinkFailHost: string;
  steamHttpTimeoutMs: number;
};

export function loadAuthEnv(): AuthEnv {
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret) throw new Error('JWT_SECRET required');
  const introspectServiceSecret = process.env.INTROSPECT_SERVICE_SECRET?.trim();
  if (!introspectServiceSecret) throw new Error('INTROSPECT_SERVICE_SECRET required');
  const realm = process.env.STEAM_REALM?.trim() || process.env.APP_BASE_URL?.trim() || 'http://localhost:8080';
  const returnUrl =
    process.env.STEAM_RETURN_URL?.trim() ||
    `${realm.replace(/\/$/, '')}/auth/steam/callback`;
  return {
    port: Number(process.env.PORT ?? 8080),
    jwtSecret,
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',
    jwtIssuer: process.env.JWT_ISSUER?.trim() || 'steamgame-auth',
    introspectServiceSecret,
    steamApiKey: process.env.STEAM_API_KEY?.trim() ?? '',
    steamOpenidRealm: realm,
    steamOpenidReturnUrl: returnUrl,
    appDeeplinkScheme: process.env.APP_DEEP_LINK_SCHEME ?? process.env.APP_DEEPLINK_SCHEME ?? 'myapp',
    appDeeplinkSuccessHost: process.env.APP_DEEP_LINK_SUCCESS_HOST ?? 'auth',
    appDeeplinkFailHost: process.env.APP_DEEP_LINK_FAIL_HOST ?? 'auth',
    steamHttpTimeoutMs: Number(process.env.STEAM_HTTP_TIMEOUT_MS ?? 12000),
  };
}
