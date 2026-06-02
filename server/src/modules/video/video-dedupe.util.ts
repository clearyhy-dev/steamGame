import type { VideoDoc } from './video.types';

export type SteamTrailerClip = {
  url: string;
  thumbnailUrl?: string;
  name?: string;
  steamMovieId?: string;
};

/** 同一条 Steam 预告片在不同 CDN/格式下的 URL 归一化 */
export function normalizePlaybackUrlKey(url: string): string {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    const path = u.pathname.replace(/\/+/g, '/').toLowerCase();
    const m =
      path.match(/\/movie(\d+)/i) ??
      path.match(/\/t(\d+)\//i) ??
      path.match(/\/(\d+)\/movie/i);
    if (m?.[1]) return `steam-movie:${m[1]}`;
    return `${u.protocol}//${u.host}${path}`.replace(/\/+$/, '');
  } catch {
    return raw.toLowerCase().split('?')[0]!.replace(/\/+$/, '');
  }
}

export function clipDedupeKey(clip: Pick<SteamTrailerClip, 'url' | 'steamMovieId'>): string {
  const smid = String(clip.steamMovieId ?? '').trim();
  if (smid) return `steam-movie:${smid}`;
  return normalizePlaybackUrlKey(clip.url);
}

export function videoDedupeKey(video: Pick<VideoDoc, 'playbackUrl' | 'tags'>): string {
  const tags = video.tags ?? [];
  const tagMovie = tags.find((t) => /^steam-movie:\d+$/i.test(String(t)));
  if (tagMovie) return String(tagMovie).toLowerCase();
  return normalizePlaybackUrlKey(String(video.playbackUrl ?? ''));
}

/** 同 key 多条时保留更优的一条（有封面 > 有 mp4 > 较新） */
function scoreVideo(v: VideoDoc): number {
  let s = 0;
  if (String(v.thumbnailUrl ?? '').trim()) s += 100;
  const u = String(v.playbackUrl ?? '');
  if (/movie_max\.mp4/i.test(u)) s += 30;
  else if (/\.mp4/i.test(u)) s += 20;
  else if (/\.webm/i.test(u)) s += 10;
  s += Math.min(50, (v.updatedAt?.toMillis?.() ?? 0) / 1_000_000_000);
  return s;
}

export function pickBestVideoPerKey(rows: VideoDoc[]): { keep: VideoDoc[]; remove: VideoDoc[] } {
  const groups = new Map<string, VideoDoc[]>();
  for (const v of rows) {
    const key = videoDedupeKey(v) || `vid:${v.videoId}`;
    const g = groups.get(key) ?? [];
    g.push(v);
    groups.set(key, g);
  }
  const keep: VideoDoc[] = [];
  const remove: VideoDoc[] = [];
  for (const g of groups.values()) {
    if (g.length === 0) continue;
    const sorted = [...g].sort((a, b) => scoreVideo(b) - scoreVideo(a));
    keep.push(sorted[0]!);
    remove.push(...sorted.slice(1));
  }
  return { keep, remove };
}

function urlFormatRank(url: string): number {
  if (/movie_max\.mp4/i.test(url)) return 3;
  if (/\.mp4/i.test(url)) return 2;
  if (/\.webm/i.test(url)) return 1;
  return 0;
}

/** 按 Steam movieId / 归一化 URL 合并，同一预告片只保留一条（优先 mp4） */
export function mergeTrailerClips(clips: SteamTrailerClip[]): SteamTrailerClip[] {
  const byKey = new Map<string, SteamTrailerClip>();
  for (const c of clips) {
    const url = String(c.url ?? '').trim();
    if (!url || !/^https?:\/\//i.test(url)) continue;
    const key = clipDedupeKey(c);
    if (!key) continue;
    const prev = byKey.get(key);
    if (!prev || urlFormatRank(url) > urlFormatRank(prev.url)) {
      byKey.set(key, {
        url,
        thumbnailUrl: c.thumbnailUrl ?? prev?.thumbnailUrl,
        name: c.name ?? prev?.name,
        steamMovieId: c.steamMovieId ?? prev?.steamMovieId,
      });
    }
  }
  return Array.from(byKey.values()).slice(0, 8);
}
