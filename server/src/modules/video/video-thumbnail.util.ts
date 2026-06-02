import type { GameCatalogDoc } from '../game/game-catalog.repository';
import type { VideoDoc } from './video.types';

/** 列表/详情展示用封面：video 自身 → catalog 预告片封面 → 游戏头图 */
export function resolveVideoThumbnailUrl(
  video: Pick<VideoDoc, 'thumbnailUrl' | 'playbackUrl' | 'signedPlaybackUrl' | 'gameId'>,
  game?: Pick<GameCatalogDoc, 'headerImage' | 'capsuleImage' | 'trailerUrls' | 'trailerThumbnailUrls'> | null,
): string | undefined {
  const direct = String(video.thumbnailUrl ?? '').trim();
  if (direct && /^https?:\/\//i.test(direct)) return direct;

  const playback = String(video.playbackUrl ?? video.signedPlaybackUrl ?? '').trim();
  const urls = game?.trailerUrls ?? [];
  const thumbs = game?.trailerThumbnailUrls ?? [];
  if (playback && urls.length > 0) {
    const i = urls.findIndex((u) => String(u).trim() === playback);
    if (i >= 0) {
      const t = String(thumbs[i] ?? '').trim();
      if (t && /^https?:\/\//i.test(t)) return t;
    }
  }

  for (const t of thumbs) {
    const s = String(t ?? '').trim();
    if (s && /^https?:\/\//i.test(s)) return s;
  }

  const header = String(game?.headerImage ?? '').trim();
  if (header && /^https?:\/\//i.test(header)) return header;
  const capsule = String(game?.capsuleImage ?? '').trim();
  if (capsule && /^https?:\/\//i.test(capsule)) return capsule;

  return undefined;
}
