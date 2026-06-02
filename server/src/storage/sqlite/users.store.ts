import type { UserDoc } from '../../modules/users/users.types';
import { sqlAll, sqlGet, sqlRun } from './sql-client';
import { dateToMs, msToDate } from './timestamp';

type UserRow = {
  id: string;
  email: string | null;
  password_hash: string | null;
  display_name: string | null;
  avatar_url: string | null;
  auth_providers_json: string;
  admin_note: string | null;
  disabled: number;
  steam_id: string | null;
  steam_persona_name: string | null;
  steam_avatar: string | null;
  steam_profile_url: string | null;
  registered_at_ms: number | null;
  created_at_ms: number;
  updated_at_ms: number;
};

function rowToDoc(r: UserRow): UserDoc {
  let authProviders: UserDoc['authProviders'] = [];
  try {
    authProviders = JSON.parse(r.auth_providers_json) as UserDoc['authProviders'];
  } catch {
    authProviders = [];
  }
  return {
    id: r.id,
    email: r.email ?? undefined,
    passwordHash: r.password_hash ?? undefined,
    displayName: r.display_name ?? undefined,
    avatarUrl: r.avatar_url ?? undefined,
    authProviders,
    adminNote: r.admin_note ?? undefined,
    disabled: r.disabled === 1,
    steamId: r.steam_id ?? undefined,
    steamPersonaName: r.steam_persona_name ?? undefined,
    steamAvatar: r.steam_avatar ?? undefined,
    steamProfileUrl: r.steam_profile_url ?? undefined,
    registeredAt: msToDate(r.registered_at_ms),
    createdAt: msToDate(r.created_at_ms) ?? new Date(),
    updatedAt: msToDate(r.updated_at_ms) ?? new Date(),
  };
}

export async function sqliteFindUserById(userId: string): Promise<UserDoc | null> {
  const row = await sqlGet<UserRow>('SELECT * FROM users WHERE id = ?', [userId]);
  return row ? rowToDoc(row) : null;
}

export async function sqliteFindUserBySteamId(steamId: string): Promise<UserDoc | null> {
  const row = await sqlGet<UserRow>('SELECT * FROM users WHERE steam_id = ? LIMIT 1', [steamId]);
  return row ? rowToDoc(row) : null;
}

export async function sqliteCreateUser(
  user: Omit<UserDoc, 'createdAt' | 'updatedAt'> & { createdAt?: Date; updatedAt?: Date },
): Promise<void> {
  const now = Date.now();
  const created = dateToMs(user.createdAt as Date) ?? now;
  const updated = dateToMs(user.updatedAt as Date) ?? now;
  await sqlRun(
    `INSERT INTO users (
      id, email, password_hash, display_name, avatar_url, auth_providers_json, admin_note, disabled,
      steam_id, steam_persona_name, steam_avatar, steam_profile_url, registered_at_ms, created_at_ms, updated_at_ms
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      email=excluded.email, password_hash=excluded.password_hash, display_name=excluded.display_name,
      avatar_url=excluded.avatar_url, auth_providers_json=excluded.auth_providers_json,
      admin_note=excluded.admin_note, disabled=excluded.disabled, steam_id=excluded.steam_id,
      steam_persona_name=excluded.steam_persona_name, steam_avatar=excluded.steam_avatar,
      steam_profile_url=excluded.steam_profile_url, registered_at_ms=excluded.registered_at_ms,
      updated_at_ms=excluded.updated_at_ms`,
    [
      user.id,
      user.email ?? null,
      user.passwordHash ?? null,
      user.displayName ?? null,
      user.avatarUrl ?? null,
      JSON.stringify(user.authProviders ?? []),
      user.adminNote ?? null,
      user.disabled ? 1 : 0,
      user.steamId ?? null,
      user.steamPersonaName ?? null,
      user.steamAvatar ?? null,
      user.steamProfileUrl ?? null,
      dateToMs(user.registeredAt as Date) ?? null,
      created,
      updated,
    ],
  );
}

export async function sqliteUpdateUser(userId: string, patch: Partial<UserDoc>): Promise<void> {
  const cur = await sqliteFindUserById(userId);
  if (!cur) return;
  const merged = { ...cur, ...patch, id: userId, updatedAt: new Date() };
  await sqliteCreateUser(merged);
}

export async function sqliteListUsers(params: {
  provider?: 'google' | 'steam';
  keyword?: string;
  limit?: number;
}): Promise<UserDoc[]> {
  const lim = Math.min(params.limit ?? 500, 1000);
  const rows = await sqlAll<UserRow>(`SELECT * FROM users ORDER BY updated_at_ms DESC LIMIT ?`, [lim]);
  let out = rows.map(rowToDoc);
  if (params.provider) {
    out = out.filter((r) => (r.authProviders ?? []).includes(params.provider!));
  }
  if (params.keyword) {
    const kw = params.keyword.toLowerCase();
    out = out.filter((r) =>
      [r.id, r.email, r.displayName, r.steamId, r.steamPersonaName].some((v) =>
        String(v ?? '').toLowerCase().includes(kw),
      ),
    );
  }
  return out;
}
