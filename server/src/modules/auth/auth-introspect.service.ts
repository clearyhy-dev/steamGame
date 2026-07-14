import axios from 'axios';
import crypto from 'crypto';
import type { Env } from '../../config/env';
import { cacheService } from '../../cache/cacheService';
import type { AuthProvider } from '../users/users.types';

export type IntrospectResult = {
  userId: string;
  steamId?: string;
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  authProviders?: AuthProvider[];
};

function tokenCacheKey(token: string): string {
  const hash = crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
  return `auth:introspect:${hash}`;
}

export async function introspectAuthToken(env: Env, token: string): Promise<IntrospectResult | null> {
  const base = env.authServiceUrl?.trim();
  const secret = env.authIntrospectSecret?.trim();
  if (!base || !secret) return null;

  const cached = await cacheService.getCache<IntrospectResult>(tokenCacheKey(token));
  if (cached?.userId) return cached;

  try {
    const { data } = await axios.post<{
      active?: boolean;
      userId?: string;
      steamId?: string;
      displayName?: string;
      email?: string;
      avatarUrl?: string;
      authProviders?: string[];
    }>(
      `${base.replace(/\/$/, '')}/auth/introspect`,
      { token },
      {
        headers: { 'X-Service-Secret': secret, 'Content-Type': 'application/json' },
        timeout: 8000,
        validateStatus: () => true,
      },
    );
    if (!data?.active || !data.userId) return null;
    const providers = (data.authProviders ?? ['steam']).map((p) =>
      p === 'google' ? 'google' : 'steam',
    ) as AuthProvider[];
    const result: IntrospectResult = {
      userId: String(data.userId),
      steamId: data.steamId ? String(data.steamId) : undefined,
      displayName: data.displayName ? String(data.displayName) : undefined,
      email: data.email ? String(data.email) : undefined,
      avatarUrl: data.avatarUrl ? String(data.avatarUrl) : undefined,
      authProviders: providers,
    };
    await cacheService.setCache(tokenCacheKey(token), result, 120);
    return result;
  } catch {
    return null;
  }
}
