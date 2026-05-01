import { Button, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { adminApi } from '../api/admin';
import type { VideoJobRow } from '../types';

export function VideoJobsPage() {
  const [searchParams] = useSearchParams();
  const [rows, setRows] = useState<VideoJobRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | undefined>();

  useEffect(() => {
    const st = searchParams.get('status');
    setStatus(st && st.length > 0 ? st : undefined);
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await adminApi.jobs({ status: status || undefined });
      setRows(list);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const cols: ColumnsType<VideoJobRow> = [
    { title: 'jobId', dataIndex: 'jobId', ellipsis: true },
    {
      title: 'videoId',
      dataIndex: 'videoId',
      render: (id: string) => <Link to={`/videos/${id}`}>{id}</Link>,
    },
    { title: 'jobType', dataIndex: 'jobType' },
    {
      title: 'status',
      dataIndex: 'status',
      render: (s: string) => <Tag color={s === 'failed' ? 'red' : undefined}>{s}</Tag>,
    },
    { title: 'attempt', dataIndex: 'attempt' },
    { title: 'startedAt', dataIndex: 'startedAt' },
    { title: 'finishedAt', dataIndex: 'finishedAt' },
    {
      title: 'error',
      dataIndex: 'errorMessage',
      ellipsis: true,
      render: (t?: string) => <Typography.Text type="danger">{t ?? '—'}</Typography.Text>,
    },
    {
      title: '操作',
      key: 'op',
      render: (_, r) => (
        <Button
          size="small"
          disabled={r.status !== 'failed'}
          onClick={async () => {
            try {
              await adminApi.retryJob(r.jobId);
              message.success('已重试');
              void load();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '失败');
            }
          }}
        >
          重试
        </Button>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Select
          allowClear
          placeholder="status"
          style={{ width: 160 }}
          value={status}
          onChange={setStatus}
          options={['pending', 'running', 'completed', 'failed'].map((s) => ({ value: s, label: s }))}
        />
        <Button onClick={() => void load()}>刷新</Button>
      </Space>
      <Table rowKey="jobId" loading={loading} columns={cols} dataSource={rows} scroll={{ x: true }} />
    </div>
  );
}
