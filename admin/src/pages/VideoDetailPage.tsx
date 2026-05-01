import { Button, Card, Descriptions, Image, Space, Table, Tag, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { adminApi } from '../api/admin';
import type { VideoRow, VideoSourceRow } from '../types';

export function VideoDetailPage() {
  const { videoId } = useParams<{ videoId: string }>();
  const nav = useNavigate();
  const [video, setVideo] = useState<VideoRow | null>(null);
  const [source, setSource] = useState<VideoSourceRow | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!videoId) return;
    setLoading(true);
    try {
      const out = await adminApi.videoDetail(videoId);
      setVideo(out.video);
      setSource(out.source);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [videoId]);

  if (loading || !video) return <Typography.Text>加载中…</Typography.Text>;

  const playback = video.playbackUrl ?? video.signedPlaybackUrl ?? '';
  const isYoutubeEmbed = playback.includes('youtube.com/embed');

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Space>
        <Button onClick={() => nav(-1)}>返回</Button>
        <Button
          type="primary"
          disabled={video.status !== 'ready'}
          onClick={async () => {
            try {
              await adminApi.publish(video.videoId);
              message.success('已发布');
              void load();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '失败');
            }
          }}
        >
          发布
        </Button>
        <Button
          onClick={async () => {
            try {
              await adminApi.unpublish(video.videoId);
              message.success('已下架');
              void load();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '失败');
            }
          }}
        >
          下架
        </Button>
        <Button
          disabled={video.deliveryType !== 'processed'}
          onClick={async () => {
            try {
              await adminApi.reprocess(video.videoId);
              message.success('已提交重处理');
              void load();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '失败');
            }
          }}
        >
          重新处理
        </Button>
      </Space>

      <Card title="基础信息">
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="videoId">{video.videoId}</Descriptions.Item>
          <Descriptions.Item label="title">{video.title}</Descriptions.Item>
          <Descriptions.Item label="gameId">{video.gameId}</Descriptions.Item>
          <Descriptions.Item label="status">
            <Tag>{video.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="visibility">
            <Tag>{video.visibility}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="deliveryType">{video.deliveryType}</Descriptions.Item>
          <Descriptions.Item label="durationSec">{video.durationSec ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="error">{video.errorMessage ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="createdAt">{video.createdAt}</Descriptions.Item>
          <Descriptions.Item label="updatedAt">{video.updatedAt}</Descriptions.Item>
        </Descriptions>
      </Card>

      {source && (
        <Card title="来源">
          <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(source, null, 2)}</pre>
        </Card>
      )}

      <Card title="预览">
        {video.thumbnailUrl && (
          <div style={{ marginBottom: 16 }}>
            <Image src={video.thumbnailUrl} width={200} />
          </div>
        )}
        {playback &&
          (isYoutubeEmbed ? (
            <iframe title="yt" src={playback} width="560" height="315" style={{ border: 0, maxWidth: '100%' }} />
          ) : (
            <video src={playback} controls width="560" style={{ maxWidth: '100%' }} />
          ))}
        {!playback && <Typography.Text type="secondary">无播放地址</Typography.Text>}
      </Card>

      <Card title="Variants">
        <Table
          size="small"
          rowKey="name"
          pagination={false}
          dataSource={video.variants ?? []}
          columns={[
            { title: 'name', dataIndex: 'name' },
            { title: 'storagePath', dataIndex: 'storagePath', ellipsis: true },
            {
              title: 'signedUrl',
              dataIndex: 'signedUrl',
              ellipsis: true,
              render: (u: string) =>
                u ? (
                  <a href={u} target="_blank" rel="noreferrer">
                    link
                  </a>
                ) : (
                  '—'
                ),
            },
          ]}
        />
      </Card>

      <Card title="其它">
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="playbackUrl">{video.playbackUrl ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="signedPlaybackUrl">{video.signedPlaybackUrl ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="storagePath">{video.storagePath ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="tags">{(video.tags ?? []).join(', ') || '—'}</Descriptions.Item>
        </Descriptions>
      </Card>
    </Space>
  );
}
