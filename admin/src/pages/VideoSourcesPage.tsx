import { Button, Form, Image, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../api/admin';
import type { VideoSourceRow } from '../types';

export function VideoSourcesPage() {
  const [rows, setRows] = useState<VideoSourceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourceType, setSourceType] = useState<string | undefined>();
  const [gameId, setGameId] = useState('');
  const [ytOpen, setYtOpen] = useState(false);
  const [stOpen, setStOpen] = useState(false);
  const [detail, setDetail] = useState<VideoSourceRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await adminApi.videoSources({
        sourceType: sourceType || undefined,
        gameId: gameId.trim() || undefined,
      });
      setRows(list);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [sourceType, gameId]);

  useEffect(() => {
    void load();
  }, [load]);

  const cols: ColumnsType<VideoSourceRow> = [
    {
      title: 'image',
      dataIndex: 'gameHeaderImage',
      width: 72,
      render: (url?: string | null) =>
        url ? <Image src={url} width={56} height={56} style={{ objectFit: 'cover' }} /> : '—',
    },
    { title: 'sourceId', dataIndex: 'sourceId', width: 120, ellipsis: true },
    { title: 'appid(gameId)', dataIndex: 'gameId' },
    { title: 'steamAppId', dataIndex: 'steamAppId' },
    {
      title: 'gameName',
      dataIndex: 'gameName',
      width: 220,
      ellipsis: { showTitle: false },
      render: (v?: string | null) => (
        <Typography.Text ellipsis={{ tooltip: v ?? '' }} style={{ maxWidth: 200, display: 'inline-block' }}>
          {v || '—'}
        </Typography.Text>
      ),
    },
    {
      title: 'description',
      dataIndex: 'gameDescription',
      width: 320,
      ellipsis: { showTitle: false },
      render: (v?: string | null) => (
        <Typography.Text ellipsis={{ tooltip: v ?? '' }} style={{ maxWidth: 300, display: 'inline-block' }}>
          {v || '—'}
        </Typography.Text>
      ),
    },
    { title: 'type', dataIndex: 'sourceType', render: (t) => <Tag>{t}</Tag> },
    { title: 'title', dataIndex: 'title', ellipsis: true },
    { title: 'ingest', dataIndex: 'ingestMode' },
    {
      title: 'enabled',
      dataIndex: 'enabled',
      render: (v: boolean) => (v ? <Tag color="green">yes</Tag> : <Tag color="red">no</Tag>),
    },
    { title: 'priority', dataIndex: 'priority' },
    {
      title: '操作',
      key: 'op',
      render: (_, r) => (
        <Space wrap>
          <Button size="small" onClick={() => setDetail(r)}>
            详情
          </Button>
          <Button size="small" onClick={() => void adminApi.patchSource(r.sourceId, { enabled: true }).then(load)}>
            启用
          </Button>
          <Button size="small" onClick={() => void adminApi.patchSource(r.sourceId, { enabled: false }).then(load)}>
            禁用
          </Button>
          <Button
            size="small"
            type="primary"
            onClick={async () => {
              try {
                const out = await adminApi.ingestSource(r.sourceId);
                message.success(`ingest: videoId=${out.videoId}`);
              } catch (e) {
                message.error(e instanceof Error ? e.message : '失败');
              }
            }}
          >
            采集
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
          placeholder="sourceType"
          style={{ width: 140 }}
          value={sourceType}
          onChange={setSourceType}
          options={[
            { value: 'youtube', label: 'youtube' },
            { value: 'steam', label: 'steam' },
            { value: 'manual', label: 'manual' },
          ]}
        />
        <Input placeholder="gameId" value={gameId} onChange={(e) => setGameId(e.target.value)} style={{ width: 160 }} />
        <Button onClick={() => void load()}>刷新</Button>
        <Button type="primary" onClick={() => setYtOpen(true)}>
          新增 YouTube
        </Button>
        <Button type="primary" onClick={() => setStOpen(true)}>
          新增 Steam
        </Button>
      </Space>

      <Table rowKey="sourceId" loading={loading} columns={cols} dataSource={rows} scroll={{ x: 1600 }} />

      <Modal title="新增 YouTube 来源" open={ytOpen} onCancel={() => setYtOpen(false)} footer={null} destroyOnClose>
        <YouTubeForm
          onDone={() => {
            setYtOpen(false);
            void load();
          }}
        />
      </Modal>

      <Modal title="新增 Steam 来源" open={stOpen} onCancel={() => setStOpen(false)} footer={null} destroyOnClose>
        <SteamForm
          onDone={() => {
            setStOpen(false);
            void load();
          }}
        />
      </Modal>

      <Modal title="来源详情" open={!!detail} onCancel={() => setDetail(null)} footer={null} width={720}>
        {detail && (
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{JSON.stringify(detail, null, 2)}</pre>
        )}
      </Modal>
    </div>
  );
}

function YouTubeForm({ onDone }: { onDone: () => void }) {
  const [f] = Form.useForm();
  return (
    <Form
      form={f}
      layout="vertical"
      onFinish={async (v) => {
        try {
          await adminApi.createYoutubeSource(v);
          message.success('已创建');
          onDone();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '失败');
        }
      }}
    >
      <Form.Item name="gameId" label="gameId" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item name="steamAppId" label="steamAppId（可选）">
        <Input />
      </Form.Item>
      <Form.Item name="sourceUrl" label="sourceUrl" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item name="title" label="title" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item name="ingestMode" label="ingestMode" initialValue="process">
        <Select options={[{ value: 'embed', label: 'embed' }, { value: 'process', label: 'process' }]} />
      </Form.Item>
      <Form.Item name="priority" label="priority" initialValue={0}>
        <InputNumber style={{ width: '100%' }} />
      </Form.Item>
      <Button type="primary" htmlType="submit" block>
        提交
      </Button>
    </Form>
  );
}

function SteamForm({ onDone }: { onDone: () => void }) {
  const [f] = Form.useForm();
  return (
    <Form
      form={f}
      layout="vertical"
      onFinish={async (v) => {
        try {
          await adminApi.createSteamSource(v);
          message.success('已创建');
          onDone();
        } catch (e) {
          message.error(e instanceof Error ? e.message : '失败');
        }
      }}
    >
      <Form.Item name="steamAppId" label="steamAppId" rules={[{ required: true }]}>
        <Input />
      </Form.Item>
      <Form.Item name="title" label="title">
        <Input placeholder="可选；不填则默认使用 Steam API 返回标题" />
      </Form.Item>
      <Form.Item name="ingestMode" label="ingestMode" initialValue="process">
        <Select options={[{ value: 'embed', label: 'embed' }, { value: 'process', label: 'process' }]} />
      </Form.Item>
      <Form.Item name="priority" label="priority" initialValue={0}>
        <InputNumber style={{ width: '100%' }} />
      </Form.Item>
      <Button type="primary" htmlType="submit" block>
        提交
      </Button>
      <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
        说明：Steam source 会自动使用 `gameId = steamAppId`，与 App Games 的 appid 对齐。
      </Typography.Paragraph>
    </Form>
  );
}
