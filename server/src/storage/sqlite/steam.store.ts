import type {
  SteamFriendsCache,
  SteamOwnedGamesCache,
  SteamProfileDoc,
  SteamRecentGamesCache,
  SteamFriendStatus,
  SteamGame,
} from '../../modules/steam/steam.types';
import { sqlGet, sqlRun, sqlAll } from './sql-client';
import { dateToMs, msToDate } from './timestamp';

export async function sqliteGetSteamProfile(steamId: string): Promise<SteamProfileDoc | null> {
  const row = await sqlGet<{
    steam_id: string;
    persona_name: string;
    real_name: string | null;
    avatar: string | null;
    avatar_full: string | null;
    profile_url: string | null;
    country_code: string | null;
    country_hydration_checked_at_ms: number | null;
    force_country_refresh_once: number;
    time_created: number | null;
    last_fetched_at_ms: number;
    linked_user_id: string | null;
  }>('SELECT * FROM steam_profiles WHERE steam_id = ?', [steamId]);
  if (!row) return null;
  return {
    steamId: row.steam_id,
    personaName: row.persona_name,
    realName: row.real_name ?? undefined,
    avatar: row.avatar ?? undefined,
    avatarFull: row.avatar_full ?? undefined,
    profileUrl: row.profile_url ?? undefined,
    countryCode: row.country_code ?? undefined,
    countryHydrationCheckedAt: msToDate(row.country_hydration_checked_at_ms),
    forceCountryRefreshOnce: row.force_country_refresh_once === 1,
    timeCreated: row.time_created ?? undefined,
    lastFetchedAt: msToDate(row.last_fetched_at_ms) ?? new Date(),
    linkedUserId: row.linked_user_id ?? undefined,
  };
}

export async function sqliteUpsertSteamProfile(
  profile: Omit<SteamProfileDoc, 'lastFetchedAt'> & { lastFetchedAt?: Date },
): Promise<void> {
  const now = Date.now();
  const lastMs = dateToMs(profile.lastFetchedAt as Date) ?? now;
  await sqlRun(
    `INSERT INTO steam_profiles (
      steam_id, persona_name, real_name, avatar, avatar_full, profile_url, country_code,
      country_hydration_checked_at_ms, force_country_refresh_once, time_created, last_fetched_at_ms, linked_user_id
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(steam_id) DO UPDATE SET
      persona_name=excluded.persona_name, real_name=excluded.real_name, avatar=excluded.avatar,
      avatar_full=excluded.avatar_full, profile_url=excluded.profile_url, country_code=excluded.country_code,
      country_hydration_checked_at_ms=excluded.country_hydration_checked_at_ms,
      force_country_refresh_once=excluded.force_country_refresh_once, time_created=excluded.time_created,
      last_fetched_at_ms=excluded.last_fetched_at_ms, linked_user_id=excluded.linked_user_id`,
    [
      profile.steamId,
      profile.personaName,
      profile.realName ?? null,
      profile.avatar ?? null,
      profile.avatarFull ?? null,
      profile.profileUrl ?? null,
      profile.countryCode ?? null,
      dateToMs(profile.countryHydrationCheckedAt as Date) ?? null,
      profile.forceCountryRefreshOnce ? 1 : 0,
      profile.timeCreated ?? null,
      lastMs,
      profile.linkedUserId ?? null,
    ],
  );
}

export async function sqliteGetFriendsCache(ownerSteamId: string): Promise<SteamFriendsCache | null> {
  const row = await sqlGet<{ owner_steam_id: string; friends_json: string; last_fetched_at_ms: number }>(
    'SELECT * FROM steam_friends_cache WHERE owner_steam_id = ?',
    [ownerSteamId],
  );
  if (!row) return null;
  return {
    ownerSteamId: row.owner_steam_id,
    friends: JSON.parse(row.friends_json) as SteamFriendStatus[],
    lastFetchedAt: msToDate(row.last_fetched_at_ms) ?? new Date(),
  };
}

export async function sqliteSetFriendsCache(ownerSteamId: string, friends: SteamFriendStatus[]): Promise<void> {
  const now = Date.now();
  await sqlRun(
    `INSERT INTO steam_friends_cache (owner_steam_id, friends_json, last_fetched_at_ms) VALUES (?,?,?)
     ON CONFLICT(owner_steam_id) DO UPDATE SET friends_json=excluded.friends_json, last_fetched_at_ms=excluded.last_fetched_at_ms`,
    [ownerSteamId, JSON.stringify(friends), now],
  );
}

export async function sqliteGetOwnedGamesCache(ownerSteamId: string): Promise<SteamOwnedGamesCache | null> {
  const row = await sqlGet<{
    owner_steam_id: string;
    games_json: string;
    game_count: number;
    last_fetched_at_ms: number;
  }>('SELECT * FROM steam_owned_games_cache WHERE owner_steam_id = ?', [ownerSteamId]);
  if (!row) return null;
  return {
    ownerSteamId: row.owner_steam_id,
    games: JSON.parse(row.games_json) as SteamGame[],
    gameCount: row.game_count,
    lastFetchedAt: msToDate(row.last_fetched_at_ms) ?? new Date(),
  };
}

export async function sqliteSetOwnedGamesCache(
  ownerSteamId: string,
  games: SteamGame[],
  gameCount: number,
): Promise<void> {
  const now = Date.now();
  await sqlRun(
    `INSERT INTO steam_owned_games_cache (owner_steam_id, games_json, game_count, last_fetched_at_ms) VALUES (?,?,?,?)
     ON CONFLICT(owner_steam_id) DO UPDATE SET games_json=excluded.games_json, game_count=excluded.game_count, last_fetched_at_ms=excluded.last_fetched_at_ms`,
    [ownerSteamId, JSON.stringify(games), gameCount, now],
  );
}

export async function sqliteGetRecentGamesCache(ownerSteamId: string): Promise<SteamRecentGamesCache | null> {
  const row = await sqlGet<{
    owner_steam_id: string;
    games_json: string;
    total_count: number;
    last_fetched_at_ms: number;
  }>('SELECT * FROM steam_recent_games_cache WHERE owner_steam_id = ?', [ownerSteamId]);
  if (!row) return null;
  return {
    ownerSteamId: row.owner_steam_id,
    games: JSON.parse(row.games_json) as SteamGame[],
    totalCount: row.total_count,
    lastFetchedAt: msToDate(row.last_fetched_at_ms) ?? new Date(),
  };
}

export async function sqliteSetRecentGamesCache(
  ownerSteamId: string,
  games: SteamGame[],
  totalCount: number,
): Promise<void> {
  const now = Date.now();
  await sqlRun(
    `INSERT INTO steam_recent_games_cache (owner_steam_id, games_json, total_count, last_fetched_at_ms) VALUES (?,?,?,?)
     ON CONFLICT(owner_steam_id) DO UPDATE SET games_json=excluded.games_json, total_count=excluded.total_count, last_fetched_at_ms=excluded.last_fetched_at_ms`,
    [ownerSteamId, JSON.stringify(games), totalCount, now],
  );
}

export async function sqliteListOwnedGamesCaches(limit: number): Promise<SteamOwnedGamesCache[]> {
  const n = Math.max(1, Math.min(limit, 300));
  const rows = await sqlAll<{ owner_steam_id: string; games_json: string; game_count: number; last_fetched_at_ms: number }>(
    'SELECT * FROM steam_owned_games_cache ORDER BY last_fetched_at_ms DESC LIMIT ?',
    [n],
  );
  return rows.map((row) => ({
    ownerSteamId: row.owner_steam_id,
    games: JSON.parse(row.games_json) as SteamGame[],
    gameCount: row.game_count,
    lastFetchedAt: msToDate(row.last_fetched_at_ms) ?? new Date(),
  }));
}

export async function sqliteListRecentGamesCaches(limit: number): Promise<SteamRecentGamesCache[]> {
  const n = Math.max(1, Math.min(limit, 300));
  const rows = await sqlAll<{ owner_steam_id: string; games_json: string; total_count: number; last_fetched_at_ms: number }>(
    'SELECT * FROM steam_recent_games_cache ORDER BY last_fetched_at_ms DESC LIMIT ?',
    [n],
  );
  return rows.map((row) => ({
    ownerSteamId: row.owner_steam_id,
    games: JSON.parse(row.games_json) as SteamGame[],
    totalCount: row.total_count,
    lastFetchedAt: msToDate(row.last_fetched_at_ms) ?? new Date(),
  }));
}
