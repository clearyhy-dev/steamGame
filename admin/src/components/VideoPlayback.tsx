import { Typography } from 'antd';
import type { VideoRow } from '../types';

export function resolvePlaybackUrl(video: Pick<VideoRow, 'playbackUrl' | 'signedPlaybackUrl'>): string {
  return String(video.playbackUrl ?? video.signedPlaybackUrl ?? '').trim();
}

export function isYoutubeEmbed(url: string): boolean {
  return /youtube\.com\/embed|youtu\.be\//i.test(url);
}

type VideoPlaybackProps = {
  video: Pick<VideoRow, 'title' | 'playbackUrl' | 'signedPlaybackUrl' | 'thumbnailUrl'>;
  width?: number | string;
  maxWidth?: number | string;
};

/** 管理端内嵌播放：YouTube iframe 或 MP4/WebM（Steam 直链等） */
export function VideoPlayback({ video, width = '100%', maxWidth = 960 }: VideoPlaybackProps) {
  const playback = resolvePlaybackUrl(video);
  if (!playback) {
    return <Typography.Text type="secondary">无播放地址</Typography.Text>;
  }

  if (isYoutubeEmbed(playback)) {
    return (
      <iframe
        title={video.title || 'video'}
        src={playback}
        width={typeof width === 'number' ? width : '100%'}
        height={typeof width === 'number' ? Math.round((width as number) * 0.5625) : 480}
        style={{ border: 0, maxWidth, aspectRatio: '16/9', width: '100%' }}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }

  return (
    <video
      key={playback}
      src={playback}
      controls
      playsInline
      preload="metadata"
      poster={video.thumbnailUrl}
      style={{ width, maxWidth, maxHeight: '70vh', background: '#000' }}
    >
      <track kind="captions" />
      您的浏览器不支持 HTML5 视频播放。
    </video>
  );
}
