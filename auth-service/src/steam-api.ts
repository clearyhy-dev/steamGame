import axios from 'axios';
import type { AuthEnv } from './env';

export type SteamPlayerSummary = {
  steamId: string;
  personaName: string;
  avatar?: string;
  avatarFull?: string;
  profileUrl?: string;
  countryCode?: string;
};

export async function fetchSteamPlayerSummaries(
  env: AuthEnv,
  steamIds: string[],
): Promise<SteamPlayerSummary[]> {
  if (!env.steamApiKey || steamIds.length === 0) return [];
  const { data } = await axios.get<{ response?: { players?: Record<string, unknown>[] } }>(
    'https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/',
    {
      params: { key: env.steamApiKey, steamids: steamIds.join(',') },
      timeout: env.steamHttpTimeoutMs,
      validateStatus: () => true,
    },
  );
  const players = data?.response?.players ?? [];
  return players.map((p) => ({
    steamId: String(p.steamid ?? ''),
    personaName: String(p.personaName ?? p.personaname ?? ''),
    avatar: p.avatar ? String(p.avatar) : undefined,
    avatarFull: p.avatarfull ? String(p.avatarfull) : undefined,
    profileUrl: p.profileurl ? String(p.profileurl) : undefined,
    countryCode: p.loccountrycode ? String(p.loccountrycode).toUpperCase() : undefined,
  }));
}
