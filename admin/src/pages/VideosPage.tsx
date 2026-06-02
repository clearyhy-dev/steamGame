import { Button, Image, Input, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '../api/admin';
import { VideoPreviewModal } from '../components/VideoPreviewModal';
import { resolvePlaybackUrl } from '../components/VideoPlayback';
import { resolveVideoPoster } from '../utils/videoThumbnail';
import type { VideoRow } from '../types';

export function VideosPage() {
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<VideoRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | undefined>();
  const [visibility, setVisibility] = useState<string | undefined>();
  const [gameId, setGameId] = useState('');
  const [previewVideo, setPreviewVideo] = useState<VideoRow | null>(null);
  const [deduping, setDeduping] = useState(false);

  useEffect(() => {
    const st = searchParams.get('status');
    const vis = searchParams.get('visibility');
    const gid = searchParams.get('gameId');
    setStatus(st && st.length > 0 ? st : undefined);
    setVisibility(vis && vis.length > 0 ? vis : undefined);
    setGameId(gid ?? '');
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await adminApi.videos({
        status: status || undefined,
        visibility: visibility || undefined,
        gameId: gameId.trim() || undefined,
      });
      setRows(list);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [status, visibility, gameId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openPreview = (row: VideoRow) => {
    const url = resolvePlaybackUrl(row);
    if (!url) {
      message.warning('该条目没有播放链接');
      return;
    }
    setPreviewVideo(row);
  };

  const cols: ColumnsType<VideoRow> = [
    {
      title: '播放',
      key: 'play',
      width: 72,
      fixed: 'left',
      render: (_, r) => {
        const canPlay = !!resolvePlaybackUrl(r);
        return (
          <Tooltip title={canPlay ? '点击播放' : '无播放地址'}>
            <Button
              type="text"
              icon={<PlayCircleOutlined style={{ fontSize: 28 }} />}
              disabled={!canPlay}
              onClick={() => openPreview(r)}
            />
          </Tooltip>
        );
      },
    },
    {
      title: '封面',
      key: 'poster',
      width: 80,
      render: (_, r) => {
        const poster = resolveVideoPoster(r);
        const canPlay = !!resolvePlaybackUrl(r);
        return poster ? (
          <Image
            src={poster}
            width={64}
            height={36}
            style={{ objectFit: 'cover', borderRadius: 4, cursor: canPlay ? 'pointer' : 'default' }}
            preview={false}
            fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='64' height='36'/%3E"
            onClick={() => canPlay && openPreview(r)}
          />
        ) : (
          <Typography.Text type="secondary">无封面</Typography.Text>
        );
      },
    },
    { title: 'videoId', dataIndex: 'videoId', width: 120, ellipsis: true },
    {
      title: 'title',
      dataIndex: 'title',
      ellipsis: true,
      render: (t: string, r) =>
        resolvePlaybackUrl(r) ? (
          <Button type="link" size="small" style={{ padding: 0, height: 'auto' }} onClick={() => openPreview(r)}>
            {t}
          </Button>
        ) : (
          t
        ),
    },
    { title: 'gameId', dataIndex: 'gameId', width: 110, render: (v?: string) => v || '—' },
    {
      title: 'gameName',
      dataIndex: 'gameName',
      width: 220,
      ellipsis: { showTitle: false },
      render: (v?: string | null) => (v ? <Tag color="blue">{v}</Tag> : '—'),
    },
    { title: 'type', dataIndex: 'sourceType', render: (t) => <Tag>{t}</Tag> },
    {
      title: 'status',
      dataIndex: 'status',
      render: (s: string) => <Tag color="blue">{s}</Tag>,
    },
    {
      title: 'visibility',
      dataIndex: 'visibility',
      render: (v: string) => <Tag>{v}</Tag>,
    },
    { title: 'delivery', dataIndex: 'deliveryType' },
    { title: 'dur(s)', dataIndex: 'durationSec' },
    { title: 'publisher', dataIndex: 'publishedBy', width: 120, render: (v?: string | null) => v || '—' },
    { title: 'publishedAt', dataIndex: 'publishedAt', width: 190, render: (v?: string | null) => v || '—' },
    {
      title: '操作',
      key: 'op',
      render: (_, r) => (
        <Space wrap>
          <Button size="small" disabled={!resolvePlaybackUrl(r)} onClick={() => openPreview(r)}>
            播放
          </Button>
          <Link to={`/videos/${r.videoId}`}>详情</Link>
          <Button
            size="small"
            type="primary"
            disabled={r.status !== 'ready'}
            onClick={async () => {
              try {
                await adminApi.publish(r.videoId);
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
            size="small"
            onClick={async () => {
              try {
                await adminApi.unpublish(r.videoId);
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
            size="small"
            disabled={r.deliveryType !== 'processed'}
            onClick={async () => {
              try {
                await adminApi.reprocess(r.videoId);
                message.success('已提交重处理');
                void load();
              } catch (e) {
                message.error(e instanceof Error ? e.message : '失败');
              }
            }}
          >
            重处理
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="status"
          style={{ width: 140 }}
          value={status}
          onChange={setStatus}
          options={['queued', 'downloading', 'processing', 'ready', 'failed', 'disabled'].map((s) => ({
            value: s,
            label: s,
          }))}
        />
        <Select
          allowClear
          placeholder="visibility"
          style={{ width: 120 }}
          value={visibility}
          onChange={setVisibility}
          options={['draft', 'public', 'private'].map((s) => ({ value: s, label: s }))}
        />
        <Input placeholder="gameId" value={gameId} onChange={(e) => setGameId(e.target.value)} style={{ width: 160 }} />
        <Button onClick={() => void load()}>刷新</Button>
        <Button
          loading={deduping}
          onClick={async () => {
            setDeduping(true);
            try {
              const r = await adminApi.dedupeTrailerVideos({ limit: 5000 });
              message.success(`已扫描 ${r.gamesScanned} 个游戏，删除重复 ${r.duplicatesRemoved} 条`);
              void load();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '清理失败');
            } finally {
              setDeduping(false);
            }
          }}
        >
          清理重复预告片
        </Button>
      </Space>
      <Table rowKey="videoId" loading={loading} columns={cols} dataSource={rows} scroll={{ x: 1800 }} />
      <VideoPreviewModal video={previewVideo} open={!!previewVideo} onClose={() => setPreviewVideo(null)} />
    </div>
  );
}
