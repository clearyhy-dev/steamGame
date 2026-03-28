import dotenv from 'dotenv';

dotenv.config();

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

export type Env = {
  port: number;
  nodeEnv: string;
  jwtSecret: string;
  jwtExpiresIn: string;

  steamApiKey: string;
  steamOpenidRealm: string;
  steamOpenidReturnUrl: string;

  appDeeplinkScheme: string;
  appDeeplinkSuccessHost: string;
  appDeeplinkFailHost: string;
  appBaseUrl: string;

  firebaseProjectId: string;
  googleApplicationCredentials?: string;

  steamHttpTimeoutMs: number;
};

export function loadEnv(): Env {
  const port = Number(process.env.PORT ?? 8080);
  if (!Number.isFinite(port) || port <= 0) throw new Error('Invalid PORT');

  return {
    port,
    nodeEnv: process.env.NODE_ENV ?? 'development',
    jwtSecret: required('JWT_SECRET'),
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '30d',

    steamApiKey: required('STEAM_API_KEY'),
    // 兼容两套命名：STEAM_OPENID_*（旧）与 STEAM_*（新）
    steamOpenidRealm: process.env.STEAM_REALM ?? process.env.STEAM_OPENID_REALM ?? required('STEAM_REALM'),
    steamOpenidReturnUrl:
      process.env.STEAM_RETURN_URL ?? process.env.STEAM_OPENID_RETURN_URL ?? required('STEAM_RETURN_URL'),

    // 兼容两套命名：APP_DEEP_LINK_*（新）与 APP_DEEPLINK_SCHEME（旧）
    appDeeplinkScheme: process.env.APP_DEEP_LINK_SCHEME ?? process.env.APP_DEEPLINK_SCHEME ?? 'myapp',
    appDeeplinkSuccessHost: process.env.APP_DEEP_LINK_SUCCESS_HOST ?? 'auth',
    appDeeplinkFailHost: process.env.APP_DEEP_LINK_FAIL_HOST ?? 'auth',
    appBaseUrl: required('APP_BASE_URL'),

    firebaseProjectId: required('FIREBASE_PROJECT_ID'),
    googleApplicationCredentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,

    steamHttpTimeoutMs: Number(process.env.STEAM_HTTP_TIMEOUT_MS ?? 8000),
  };
}

