import axios from 'axios';
import type { Env } from '../../config/env';

type SteamMoviesResponse = {
  [appId: string]: {
    success?: boolean;
    data?: {
      name?: string;
      movies?: Array<{
        id: number;
        name: string;
        thumbnail?: string;
        highlight?: boolean;
        webm?: { max?: string; '480'?: string };
        mp4?: { max?: string; '480'?: string };
      }>;
    };
  };
};

/** Fetch best mp4 trailer URL from Steam store API */
export async function fetchSteamTrailerMp4(env: Env, steamAppId: string): Promise<{ title: string; mp4Url: string }> {
  const url = `https://store.steampowered.com/api/appdetails`;
  const { data } = await axios.get<SteamMoviesResponse>(url, {
    params: { appids: steamAppId, l: 'english' },
    timeout: env.steamHttpTimeoutMs,
    validateStatus: () => true,
  });

  const block = data[steamAppId];
  if (!block?.success || !block.data?.movies?.length) {
    throw new Error('No trailer/movies found for this Steam app');
  }

  const movie = block.data.movies.find((m) => m.mp4?.max || m.mp4?.['480']) ?? block.data.movies[0];
  const mp4Url = movie.mp4?.max ?? movie.mp4?.['480'];
  if (!mp4Url) throw new Error('No mp4 trailer URL in Steam response');

  return {
    title: block.data.name ?? movie.name ?? `App ${steamAppId}`,
    mp4Url,
  };
}
