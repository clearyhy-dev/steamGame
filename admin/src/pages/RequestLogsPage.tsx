import { Button, Input, InputNumber, Select, Space, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../api/admin';
import type { AdminRequestLogRow } from '../types';

export function RequestLogsPage() {
  const [rows, setRows] = useState<AdminRequestLogRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [userId, setUserId] = useState('');
  const [pathPrefix, setPathPrefix] = useState('');
  const [method, setMethod] = useState<string | undefined>();
  const [statusCode, setStatusCode] = useState<number | undefined>();
  const [limit, setLimit] = useState<number>(100);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await adminApi.requestLogs({
        userId: userId.trim() || undefined,
        pathPrefix: pathPrefix.trim() || undefined,
        method,
        statusCode,
        limit,
      });
      setRows(out.rows ?? []);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载请求日志失败');
    } finally {
      setLoading(false);
    }
  }, [userId, pathPrefix, method, statusCode, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  const cols: ColumnsType<AdminRequestLogRow> = [
    {
      title: 'time',
      dataIndex: 'createdAt',
      width: 180,
      render: (v?: string | null) => v ?? '-',
    },
    {
      title: 'method',
      dataIndex: 'method',
      width: 90,
      render: (v: string) => <Tag color={v === 'GET' ? 'blue' : 'purple'}>{v}</Tag>,
    },
    { title: 'path', dataIndex: 'path', width: 260, ellipsis: true },
    { title: 'status', dataIndex: 'statusCode', width: 90 },
    { title: 'ms', dataIndex: 'durationMs', width: 90 },
    { title: 'userId', dataIndex: 'userId', width: 220, ellipsis: true },
    {
      title: 'error',
      dataIndex: 'errorCode',
      width: 160,
      render: (v?: string) => (v ? <Tag color="red">{v}</Tag> : <Tag>none</Tag>),
    },
    {
      title: '详情',
      key: 'detail',
      width: 140,
      render: (_v, r) => <Typography.Text code>{r.requestId}</Typography.Text>,
    },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input
          placeholder="userId"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          style={{ width: 220 }}
        />
        <Input
          placeholder="pathPrefix (e.g. /v1/recommendations)"
          value={pathPrefix}
          onChange={(e) => setPathPrefix(e.target.value)}
          style={{ width: 260 }}
        />
        <Select
          allowClear
          placeholder="method"
          value={method}
          style={{ width: 120 }}
          onChange={(v) => setMethod(v)}
          options={['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].map((x) => ({ label: x, value: x }))}
        />
        <InputNumber
          placeholder="status"
          value={statusCode}
          onChange={(v) => setStatusCode(v ?? undefined)}
          min={100}
          max={599}
        />
        <InputNumber
          placeholder="limit"
          value={limit}
          onChange={(v) => setLimit(Number(v ?? 100))}
          min={1}
          max={200}
        />
        <Button type="primary" onClick={() => void load()}>
          查询
        </Button>
      </Space>

      <Table
        rowKey={(r) => r.logId ?? r.requestId}
        loading={loading}
        columns={cols}
        dataSource={rows}
        scroll={{ x: true }}
        expandable={{
          expandedRowRender: (r) => (
            <div>
              <Typography.Paragraph>
                <Typography.Text strong>IP:</Typography.Text> {r.ip ?? '-'}{' '}
                <Typography.Text strong style={{ marginLeft: 16 }}>
                  UA:
                </Typography.Text>{' '}
                {r.userAgent ?? '-'}
              </Typography.Paragraph>
              <Typography.Paragraph>
                <Typography.Text strong>query:</Typography.Text>{' '}
                <Typography.Text code>{JSON.stringify(r.query ?? {}, null, 2)}</Typography.Text>
              </Typography.Paragraph>
              <Typography.Paragraph>
                <Typography.Text strong>bodyKeys:</Typography.Text>{' '}
                <Typography.Text code>{JSON.stringify(r.bodyKeys ?? [])}</Typography.Text>
              </Typography.Paragraph>
            </div>
          ),
        }}
      />
    </div>
  );
}
