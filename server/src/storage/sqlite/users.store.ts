import type { UserDoc } from '../../modules/users/users.types';
import { sqlAll, sqlGet, sqlRun } from './sql-client';
import { dateToMs, msToDate } from './timestamp';
import { logger } from '../../utils/logger';

let defaultCountryColumnEnsured = false;
let proUntilColumnEnsured = false;

async function sqliteEnsureDefaultCountryColumn(): Promise<void> {
  if (defaultCountryColumnEnsured) return;
  const cols = await sqlGet<{ n: number }>(
    "SELECT COUNT(*) AS n FROM pragma_table_info('users') WHERE name='default_country_code'",
  );
  if ((cols?.n ?? 0) === 0) {
    try {
      await sqlRun(`ALTER TABLE users ADD COLUMN default_country_code TEXT`);
      logger.info('[users-schema] default_country_code column added');
    } catch (e) {
      logger.warn(`[users-schema] default_country_code migrate: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  defaultCountryColumnEnsured = true;
}

async function sqliteEnsureProUntilColumn(): Promise<void> {
  if (proUntilColumnEnsured) return;
  await sqliteEnsureDefaultCountryColumn();
  const cols = await sqlGet<{ n: number }>(
    "SELECT COUNT(*) AS n FROM pragma_table_info('users') WHERE name='pro_until_ms'",
  );
  if ((cols?.n ?? 0) === 0) {
    try {
      await sqlRun(`ALTER TABLE users ADD COLUMN pro_until_ms INTEGER`);
      logger.info('[users-schema] pro_until_ms column added');
    } catch (e) {
      logger.warn(`[users-schema] pro_until_ms migrate: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  proUntilColumnEnsured = true;
}

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
  country_code: string | null;
  country_source: string | null;
  country_updated_at_ms: number | null;
  default_country_code: string | null;
  pro_until_ms: number | null;
  google_sub: string | null;
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
    googleSub: r.google_sub ?? undefined,
    countryCode: r.country_code ?? undefined,
    countrySource: (r.country_source as UserDoc['countrySource']) ?? undefined,
    countryUpdatedAt: msToDate(r.country_updated_at_ms),
    defaultCountryCode: r.default_country_code ?? undefined,
    proUntilMs: r.pro_until_ms ?? undefined,
    registeredAt: msToDate(r.registered_at_ms),
    createdAt: msToDate(r.created_at_ms) ?? new Date(),
    updatedAt: msToDate(r.updated_at_ms) ?? new Date(),
  };
}

export async function sqliteFindUserById(userId: string): Promise<UserDoc | null> {
  await sqliteEnsureProUntilColumn();
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
      steam_id, steam_persona_name, steam_avatar, steam_profile_url, registered_at_ms,
      country_code, country_source, country_updated_at_ms, default_country_code, pro_until_ms, google_sub,
      created_at_ms, updated_at_ms
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET
      email=excluded.email, password_hash=excluded.password_hash, display_name=excluded.display_name,
      avatar_url=excluded.avatar_url, auth_providers_json=excluded.auth_providers_json,
      admin_note=excluded.admin_note, disabled=excluded.disabled, steam_id=excluded.steam_id,
      steam_persona_name=excluded.steam_persona_name, steam_avatar=excluded.steam_avatar,
      steam_profile_url=excluded.steam_profile_url, registered_at_ms=excluded.registered_at_ms,
      country_code=COALESCE(excluded.country_code, users.country_code),
      country_source=COALESCE(excluded.country_source, users.country_source),
      country_updated_at_ms=COALESCE(excluded.country_updated_at_ms, users.country_updated_at_ms),
      default_country_code=COALESCE(excluded.default_country_code, users.default_country_code),
      pro_until_ms=COALESCE(excluded.pro_until_ms, users.pro_until_ms),
      google_sub=COALESCE(excluded.google_sub, users.google_sub),
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
      user.countryCode ?? null,
      user.countrySource ?? null,
      dateToMs(user.countryUpdatedAt as Date) ?? null,
      user.defaultCountryCode ?? null,
      user.proUntilMs ?? null,
      user.googleSub ?? null,
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
  await sqliteEnsureDefaultCountryColumn();
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
