import { mapToSteamAppDetailsLang } from './steam-language.util';

/**
 * Steam 商店应用页带区域与语言参数，保证不同国家打开的是对应区域价与结账货币。
 * `cc` 与 Country/Steam 配置中的 `steamCc` 一致；`l` 与配置中的 `steamLanguage` 一致。
 */
export function buildRegionalSteamStoreAppUrl(appid: string, steamStoreCc: string, steamLanguage: string): string {
  const id = String(appid ?? '').trim();
  if (!id) return 'https://store.steampowered.com/';
  const rawCc = String(steamStoreCc ?? 'us').trim().toLowerCase();
  const cc = /^[a-z]{2}$/.test(rawCc) ? rawCc : 'us';
  const l = mapToSteamAppDetailsLang(steamLanguage);
  const q = new URLSearchParams({ cc, l });
  return `https://store.steampowered.com/app/${encodeURIComponent(id)}/?${q.toString()}`;
}
