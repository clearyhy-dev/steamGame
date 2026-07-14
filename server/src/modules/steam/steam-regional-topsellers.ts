import axios from 'axios';
import type { Env } from '../../config/env';
import { getEffectiveEnv } from '../../config/runtime-config';
import { mapToSteamAppDetailsLang } from './steam-language.util';
import { logger } from '../../utils/logger';

const TOPSELLERS_SEARCH_URL = 'https://store.steampowered.com/search/results/';
const PAGE_SIZE = 50;
const APPID_RE = /data-ds-appid="(\d+)"/g;

const STEAM_STORE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/javascript, text/html, application/xml, text/xml, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'X-Requested-With': 'XMLHttpRequest',
};

function parseAppidsFromResultsHtml(html: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  if (!html) return out;
  for (const m of html.matchAll(APPID_RE)) {
    const id = String(m[1] ?? '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Steam 商店按 `cc` 区域畅销榜（filter=topsellers），热度从高到低。
 * 文档：Store Search `infinite=1` 返回 `results_html`，解析 `data-ds-appid`。
 */
export async function fetchRegionalTopSellerAppids(
  env: Env,
  opts: { steamCc: string; steamLanguage: string; limit: number },
): Promise<string[]> {
  const limit = Math.max(1, Math.min(Math.trunc(opts.limit), 500));
  const cc = String(opts.steamCc || 'us')
    .trim()
    .toLowerCase();
  const l = mapToSteamAppDetailsLang(String(opts.steamLanguage || 'en').trim() || 'en');
  const e = await getEffectiveEnv(env);
  const timeoutMs = Math.max(e.steamHttpTimeoutMs, 15000);

  const merged: string[] = [];
  const seen = new Set<string>();

  const pages: number[] = [];
  for (let start = 0; start < limit; start += PAGE_SIZE) pages.push(start);

  const pageResults = await Promise.all(
    pages.map(async (start) => {
      const count = Math.min(PAGE_SIZE, limit - start);
      try {
        const { data, status } = await axios.get<{ success?: number; results_html?: string }>(TOPSELLERS_SEARCH_URL, {
          params: {
            query: '',
            start,
            count,
            dynamic_data: '',
            sort_by: '_ASC',
            infinite: 1,
            cc,
            l,
            filter: 'topsellers',
          },
          headers: {
            ...STEAM_STORE_HEADERS,
            Referer: `https://store.steampowered.com/search/?filter=topsellers&cc=${cc}`,
          },
          timeout: timeoutMs,
          validateStatus: () => true,
        });
        const html = data?.results_html ?? '';
        const ids = parseAppidsFromResultsHtml(html);
        if (ids.length === 0) {
          logger.warn(
            `[steam-topsellers] cc=${cc} start=${start} http=${status} htmlLen=${html.length} parsed=0`,
          );
        }
        return ids;
      } catch (err) {
        logger.warn(
          `[steam-topsellers] cc=${cc} start=${start} err=${err instanceof Error ? err.message : String(err)}`,
        );
        return [] as string[];
      }
    }),
  );

  for (const pageIds of pageResults) {
    for (const id of pageIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      merged.push(id);
      if (merged.length >= limit) break;
    }
    if (merged.length >= limit) break;
  }

  return merged.slice(0, limit);
}
