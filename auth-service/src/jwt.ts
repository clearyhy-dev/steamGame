import jwt from 'jsonwebtoken';
import type { AuthEnv } from './env';

export type AuthTokenClaims = {
  userId: string;
  steamId: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  authProviders: string[];
};

export function signAuthToken(claims: AuthTokenClaims, env: AuthEnv): string {
  return jwt.sign(
    {
      steamId: claims.steamId,
      displayName: claims.displayName ?? '',
      email: claims.email ?? '',
      avatarUrl: claims.avatarUrl ?? '',
      authProviders: claims.authProviders,
    },
    env.jwtSecret,
    {
      expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
      subject: claims.userId,
      issuer: env.jwtIssuer,
    },
  );
}

export function verifyAuthToken(token: string, env: AuthEnv): AuthTokenClaims | null {
  try {
    const decoded = jwt.verify(token, env.jwtSecret, { issuer: env.jwtIssuer }) as jwt.JwtPayload;
    const userId = String(decoded.sub ?? '').trim();
    const steamId = String(decoded.steamId ?? '').trim();
    if (!userId || !steamId) return null;
    const providersRaw = decoded.authProviders;
    const authProviders = Array.isArray(providersRaw)
      ? providersRaw.map((x) => String(x))
      : ['steam'];
    return {
      userId,
      steamId,
      displayName: decoded.displayName ? String(decoded.displayName) : undefined,
      email: decoded.email ? String(decoded.email) : undefined,
      avatarUrl: decoded.avatarUrl ? String(decoded.avatarUrl) : undefined,
      authProviders,
    };
  } catch {
    return null;
  }
}
