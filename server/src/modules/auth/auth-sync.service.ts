import type { IntrospectResult } from './auth-introspect.service';
import { UsersRepository } from '../users/users.repository';
import type { AuthProvider } from '../users/users.types';

export async function ensureUserFromIntrospect(result: IntrospectResult): Promise<void> {
  const users = new UsersRepository();
  const existing = await users.findById(result.userId);
  const now = new Date();
  const providers = (result.authProviders?.length ? result.authProviders : ['steam']) as AuthProvider[];

  if (!existing) {
    await users.createUser({
      id: result.userId,
      email: result.email ?? '',
      displayName: result.displayName ?? result.steamId ?? result.userId,
      avatarUrl: result.avatarUrl ?? '',
      authProviders: providers,
      steamId: result.steamId,
      steamPersonaName: result.displayName,
      steamAvatar: result.avatarUrl,
      registeredAt: now,
      createdAt: now,
      updatedAt: now,
    });
    return;
  }

  const mergedProviders = Array.from(new Set([...(existing.authProviders ?? []), ...providers])) as AuthProvider[];
  await users.updateUser(result.userId, {
    authProviders: mergedProviders,
    steamId: result.steamId ?? existing.steamId,
    steamPersonaName: result.displayName ?? existing.steamPersonaName,
    steamAvatar: result.avatarUrl ?? existing.steamAvatar,
    displayName: existing.displayName || result.displayName,
    avatarUrl: existing.avatarUrl || result.avatarUrl,
    email: existing.email || result.email,
    updatedAt: now,
  });
}
