import { mergeTrailerClips, type SteamTrailerClip } from '../video/video-dedupe.util';

export type { SteamTrailerClip };

function pickMovieUrl(m: Record<string, unknown>): string {
  const mp4 = m.mp4 as Record<string, string> | undefined;
  const webm = m.webm as Record<string, string> | undefined;
  const mp4Max = String(mp4?.max ?? '').trim();
  const mp4_480 = String(mp4?.['480'] ?? '').trim();
  const webmMax = String(webm?.max ?? '').trim();
  return mp4Max || mp4_480 || webmMax;
}

export function parseSteamMovies(moviesRaw: unknown): SteamTrailerClip[] {
  if (!Array.isArray(moviesRaw)) return [];
  const byMovie = new Map<string, SteamTrailerClip>();
  for (const raw of moviesRaw) {
    if (!raw || typeof raw !== 'object') continue;
    const m = raw as Record<string, unknown>;
    const url = pickMovieUrl(m);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const steamMovieId = m.id != null ? String(m.id) : undefined;
    const key = steamMovieId ? `smid:${steamMovieId}` : url;
    const thumb = String(m.thumbnail ?? '').trim();
    const clip: SteamTrailerClip = {
      url,
      thumbnailUrl: thumb && /^https?:\/\//i.test(thumb) ? thumb : undefined,
      name: m.name != null ? String(m.name) : undefined,
      steamMovieId,
    };
    const prev = byMovie.get(key);
    if (!prev) {
      byMovie.set(key, clip);
      continue;
    }
    const rank = (u: string) => (u.includes('movie_max.mp4') ? 2 : u.includes('.mp4') ? 1 : 0);
    if (rank(url) > rank(prev.url)) byMovie.set(key, clip);
    if (byMovie.size >= 8) break;
  }
  return Array.from(byMovie.values()).slice(0, 8);
}

export { mergeTrailerClips };
