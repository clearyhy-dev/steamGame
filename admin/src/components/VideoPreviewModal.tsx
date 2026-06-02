import { Modal, Space, Typography } from 'antd';
import { Link } from 'react-router-dom';
import type { VideoRow } from '../types';
import { VideoPlayback, resolvePlaybackUrl } from './VideoPlayback';
import { resolveVideoPoster } from '../utils/videoThumbnail';

type VideoPreviewModalProps = {
  video: VideoRow | null;
  open: boolean;
  onClose: () => void;
};

export function VideoPreviewModal({ video, open, onClose }: VideoPreviewModalProps) {
  const playback = video ? resolvePlaybackUrl(video) : '';
  const poster = video ? resolveVideoPoster(video) : undefined;

  return (
    <Modal
      title={video?.title ?? '视频预览'}
      open={open && !!video}
      onCancel={onClose}
      footer={null}
      width={920}
      destroyOnClose
      styles={{ body: { paddingTop: 12 } }}
    >
      {video && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {poster && (
            <img
              src={poster}
              alt=""
              style={{ width: '100%', maxHeight: 160, objectFit: 'cover', borderRadius: 8 }}
            />
          )}
          <VideoPlayback video={video} />
          <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }} copyable={!!playback}>
            {playback || '—'}
          </Typography.Paragraph>
          <Space wrap>
            <Link to={`/videos/${video.videoId}`} onClick={onClose}>
              打开详情页
            </Link>
            {playback && (
              <a href={playback} target="_blank" rel="noreferrer">
                新窗口打开
              </a>
            )}
            {video.gameId && <Typography.Text>gameId: {video.gameId}</Typography.Text>}
          </Space>
        </Space>
      )}
    </Modal>
  );
}
