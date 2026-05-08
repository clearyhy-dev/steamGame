import { Card, Descriptions, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { adminApi } from '../api/admin';
import type { MetaEndpointRow, MetaEndpointsResponse } from '../types';

function scopeTag(scope: MetaEndpointRow['scope']) {
  const map: Record<MetaEndpointRow['scope'], { color: string; label: string }> = {
    app_backend: { color: 'blue', label: 'App (auth)' },
    app_public: { color: 'green', label: 'App (public)' },
    admin: { color: 'purple', label: 'Admin' },
    third_party: { color: 'orange', label: '3rd party' },
  };
  const v = map[scope];
  return <Tag color={v.color}>{v.label}</Tag>;
}

export function AppDiagnosticsPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MetaEndpointsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const out = await adminApi.metaEndpoints();
      setData(out);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const grouped = useMemo(() => {
    const rows = data?.endpoints ?? [];
    const by: Record<string, MetaEndpointRow[]> = {};
    for (const r of rows) {
      const k = r.scope;
      by[k] = by[k] ?? [];
      by[k].push(r);
    }
    return by;
  }, [data]);

  return (
    <div>
      <Typography.Title level={3} style={{ marginTop: 0 }}>
        App Diagnostics
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        This page is read-only troubleshooting metadata. Endpoint paths are intentionally not configurable.
      </Typography.Paragraph>

      <Card loading={loading} style={{ marginBottom: 16 }}>
        <Descriptions size="small" column={1}>
          <Descriptions.Item label="apiBaseUrl">{data?.apiBaseUrl ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="generatedAt">{data?.generatedAt ?? '—'}</Descriptions.Item>
          <Descriptions.Item label="error">{err ?? '—'}</Descriptions.Item>
        </Descriptions>
      </Card>

      {Object.entries(grouped).map(([scope, rows]) => (
        <Card key={scope} title={<span>{scopeTag(scope as any)} {scope}</span>} style={{ marginBottom: 16 }}>
          {rows.map((r, idx) => (
            <div key={`${r.method}_${r.path}_${idx}`} style={{ marginBottom: 10 }}>
              <Typography.Text strong>
                <Tag color={r.authRequired ? 'red' : 'default'}>{r.authRequired ? 'auth' : 'public'}</Tag>
                <Tag>{r.method}</Tag>
                <Typography.Text code>{r.path}</Typography.Text>
              </Typography.Text>
              <div style={{ marginTop: 2 }}>
                <Typography.Text>{r.name}</Typography.Text>
                {r.usedBy?.length ? (
                  <Typography.Text type="secondary"> · used by: {r.usedBy.join(', ')}</Typography.Text>
                ) : null}
                {r.notes ? <Typography.Text type="secondary"> · {r.notes}</Typography.Text> : null}
              </div>
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

