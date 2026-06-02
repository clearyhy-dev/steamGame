import { VideoRepository } from './video.repository';
import { VideoSourceRepository } from './video-source.repository';
import { logger } from '../../utils/logger';
import { parseSteamMovies } from '../steam/steam-trailers.parse';
import {
  clipDedupeKey,
  mergeTrailerClips,
  pickBestVideoPerKey,
  videoDedupeKey,
  type SteamTrailerClip,
} from './video-dedupe.util';

export type { SteamTrailerClip };

const TRAILER_URL_RE =
  /https?:\/\/[^\s"'<>]+(?:\.(?:mp4|webm)|\/movie\/[^\s"'<>]+)/gi;

/** 从 catalog 文档或原始 JSON 文本提取预告片直链（无则返回空） */
export function extractTrailerClipsFromCatalog(
  doc: {
    trailerUrls?: string[];
    trailerThumbnailUrls?: string[];
    headerImage?: string;
  } | null
  | undefined,
  rawJson?: string,
): SteamTrailerClip[] {
  const urls = (doc?.trailerUrls ?? [])
    .map((u) => String(u ?? '').trim())
    .filter((u) => /^https?:\/\//i.test(u));
  const thumbs = (doc?.trailerThumbnailUrls ?? []).map((t) => String(t ?? '').trim());
  if (urls.length > 0) {
    return mergeTrailerClips(
      urls.slice(0, 16).map((url, i) => ({
        url,
        thumbnailUrl: thumbs[i] && /^https?:\/\//i.test(thumbs[i]!) ? thumbs[i] : undefined,
      })),
    );
  }

  const raw = String(rawJson ?? '');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as { movies?: unknown };
    const fromMovies = parseSteamMovies(parsed.movies);
    if (fromMovies.length > 0) return fromMovies;
  } catch {
    /* regex fallback */
  }

  const urlOnly: string[] = [];
  let m: RegExpExecArray | null;
  TRAILER_URL_RE.lastIndex = 0;
  while ((m = TRAILER_URL_RE.exec(raw)) !== null) {
    const u = m[0].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
    if (/\.(mp4|webm)(\?|$)/i.test(u) || /\/movie\//i.test(u)) urlOnly.push(u);
  }
  const header = String(doc?.headerImage ?? '').trim();
  return mergeTrailerClips(
    Array.from(new Set(urlOnly)).map((url) => ({
      url,
      thumbnailUrl: header && /^https?:\/\//i.test(header) ? header : undefined,
    })),
  );
}

/** @deprecated */
export function extractTrailerUrlsFromCatalog(
  doc: { trailerUrls?: string[] } | null | undefined,
  rawJson?: string,
): string[] {
  return extractTrailerClipsFromCatalog(doc, rawJson).map((c) => c.url);
}

/** 删除同游戏下重复视频，保留质量最好的一条 */
export async function dedupeVideosForGame(videos: VideoRepository, gameId: string): Promise<number> {
  const key = String(gameId ?? '').trim();
  if (!key) return 0;
  const existing = await videos.list({ gameId: key, limit: 1000 });
  const { remove } = pickBestVideoPerKey(existing);
  for (const v of remove) {
    await videos.deleteById(v.videoId);
  }
  if (remove.length > 0) {
    logger.info(`[videos] dedupe appid=${key} removed=${remove.length} kept=${existing.length - remove.length}`);
  }
  return remove.length;
}

/** 详情同步得到的 Steam 预告片写入 `videos`（embed / ready，不跑转码流水线） */
export async function upsertSteamTrailersAsVideos(
  videos: VideoRepository,
  sources: VideoSourceRepository,
  appid: string,
  gameName: string,
  clips: SteamTrailerClip[],
  options?: { headerImageFallback?: string },
): Promise<number> {
  const key = String(appid ?? '').trim();
  if (!key) return 0;
  const merged = mergeTrailerClips(clips);
  if (merged.length === 0) return 0;

  await dedupeVideosForGame(videos, key);

  const headerFallback =
    options?.headerImageFallback && /^https?:\/\//i.test(options.headerImageFallback)
      ? options.headerImageFallback
      : undefined;

  let source = await sources.findSteamByAppId(key);
  if (!source) {
    const sourceId = await sources.create({
      gameId: key,
      steamAppId: key,
      sourceType: 'steam',
      title: `${gameName || `App ${key}`} · Steam`,
      sourceUrl: merged[0]!.url,
      ingestMode: 'embed',
      enabled: true,
      priority: 100,
    });
    source = await sources.findById(sourceId);
  }
  if (!source) return 0;

  const existing = await videos.list({ gameId: key, limit: 1000 });
  const byKey = new Map<string, (typeof existing)[0]>();
  for (const v of existing) {
    const dk = videoDedupeKey(v);
    if (!dk) continue;
    if (!byKey.has(dk)) byKey.set(dk, v);
  }

  let created = 0;
  let patched = 0;
  const titleBase = String(gameName ?? '').trim() || `App ${key}`;

  for (let i = 0; i < merged.length; i++) {
    const clip = merged[i]!;
    const playbackUrl = clip.url;
    const thumbnailUrl = clip.thumbnailUrl ?? headerFallback;
    const dk = clipDedupeKey(clip);

    const prev = byKey.get(dk);
    if (prev) {
      const patch: Record<string, unknown> = {};
      if (thumbnailUrl && !String(prev.thumbnailUrl ?? '').trim()) patch.thumbnailUrl = thumbnailUrl;
      const exact = String(prev.playbackUrl ?? '').trim() === playbackUrl;
      if (!exact && playbackUrl) patch.playbackUrl = playbackUrl;
      if (Object.keys(patch).length > 0) {
        await videos.update(prev.videoId, patch);
        patched++;
      }
      continue;
    }

    const tags = ['steam-trailer', 'catalog-detail-sync'];
    if (clip.steamMovieId) tags.push(`steam-movie:${clip.steamMovieId}`);

    const videoId = await videos.create({
      sourceId: source.sourceId,
      gameId: key,
      steamAppId: key,
      sourceType: 'steam',
      title: merged.length > 1 ? `${titleBase} · trailer ${i + 1}` : `${titleBase} · trailer`,
      status: 'ready',
      visibility: 'public',
      deliveryType: 'embed',
      playbackUrl,
      thumbnailUrl,
      gameName: titleBase,
      tags,
    });
    created++;
    byKey.set(dk, {
      videoId,
      sourceId: source.sourceId,
      gameId: key,
      playbackUrl,
      thumbnailUrl,
    } as (typeof existing)[0]);
  }

  if (created > 0 || patched > 0) {
    logger.info(`[videos] steam trailers appid=${key} created=${created} patched=${patched}`);
  }
  return created;
}

export async function upsertSteamTrailerUrlsAsVideos(
  videos: VideoRepository,
  sources: VideoSourceRepository,
  appid: string,
  gameName: string,
  trailerUrls: string[],
  options?: { headerImageFallback?: string },
): Promise<number> {
  const clips = trailerUrls
    .map((u) => String(u ?? '').trim())
    .filter((u) => /^https?:\/\//i.test(u))
    .map((url) => ({ url, thumbnailUrl: options?.headerImageFallback }));
  return upsertSteamTrailersAsVideos(videos, sources, appid, gameName, clips, options);
}
