import { Card, Descriptions, Tag, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { adminApi } from '../api/admin';
import type { MetaEndpointRow, MetaEndpointsResponse } from '../types';

function scopeTag(scope: MetaEndpointRow['scope']) {
  const map: Record<MetaEndpointRow['scope'], { color: string; label: string }> = {
    app_backend: { color: 'blue', label: '域 · App需登录' },
    app_public: { color: 'green', label: '域 · 公开' },
    admin: { color: 'purple', label: '域 · Admin' },
    third_party: { color: 'orange', label: '外部第三方' },
  };
  const v = map[scope];
  return <Tag color={v.color}>{v.label}</Tag>;
}

function audienceTag(audience: MetaEndpointRow['audience']) {
  if (!audience) return null;
  const map: Record<NonNullable<MetaEndpointRow['audience']>, { color: string; label: string }> = {
    app: { color: 'cyan', label: '调用·App' },
    admin: { color: 'geekblue', label: '调用·后台' },
    public: { color: 'lime', label: '调用·公开' },
    browser_oauth: { color: 'gold', label: '调用·OAuth' },
    ops: { color: 'default', label: '调用·运维' },
    mixed: { color: 'magenta', label: '调用·混合' },
  };
  const v = map[audience];
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
        只读排障元数据。标签「调用·*」表示主要调用方（App / 后台 / 公开等）；「域 · *」表示接口域。进程内定时 Worker（无 HTTP）见 Swagger 文档首页说明。
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
                {audienceTag(r.audience)}
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
              {r.whenToCall || r.purpose ? (
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 4, fontSize: 12 }}>
                  {r.whenToCall ? <>何时：{r.whenToCall}</> : null}
                  {r.whenToCall && r.purpose ? <br /> : null}
                  {r.purpose ? <>作用：{r.purpose}</> : null}
                </Typography.Paragraph>
              ) : null}
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

