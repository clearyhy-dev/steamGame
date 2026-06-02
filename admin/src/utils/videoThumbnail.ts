import type { VideoRow } from '../types';

/** 列表/预览用封面（API 已合并 Steam 预告片封面与游戏头图） */
export function resolveVideoPoster(
  video: Pick<VideoRow, 'thumbnailUrl' | 'gameHeaderImage'>,
): string | undefined {
  const thumb = String(video.thumbnailUrl ?? '').trim();
  if (thumb) return thumb;
  const header = String(video.gameHeaderImage ?? '').trim();
  return header || undefined;
}
