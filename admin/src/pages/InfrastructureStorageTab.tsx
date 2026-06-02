import {
  Alert,
  Button,
  Card,
  Descriptions,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../api/admin';
import type {
  InfrastructureConfigResponse,
  InfrastructureMinioBrowseResponse,
  InfrastructureRedisBrowseResponse,
} from '../types';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const storeColor: Record<string, string> = {
  'vultr-minio': 'green',
  'vultr-redis': 'orange',
  'vultr-sqlite': 'blue',
  'gcp-firestore': 'default',
  'gcp-gcs': 'red',
  memory: 'purple',
};

export function InfrastructureStorageTab() {
  const [config, setConfig] = useState<InfrastructureConfigResponse | null>(null);
  const [minio, setMinio] = useState<InfrastructureMinioBrowseResponse | null>(null);
  const [redis, setRedis] = useState<InfrastructureRedisBrowseResponse | null>(null);
  const [prefix, setPrefix] = useState('cache/');
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, m, r] = await Promise.all([
        adminApi.getInfrastructureConfig(),
        adminApi.browseInfrastructureMinio({ prefix, limit: 80 }),
        adminApi.browseInfrastructureRedis(),
      ]);
      setConfig(cfg);
      setMinio(m);
      setRedis(r);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载基础设施信息失败');
    } finally {
      setLoading(false);
    }
  }, [prefix]);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshMinio = async (p?: string) => {
    try {
      const m = await adminApi.browseInfrastructureMinio({ prefix: p ?? prefix, limit: 80 });
      setMinio(m);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '刷新 MinIO 列表失败');
    }
  };

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="大对象存储策略"
        description="折扣 JSON、公开缓存、视频文件等大体积数据应只写入 Vultr MinIO；GCP 仅保留 Firestore 结构化元数据与小配置。下列连接信息来自 Cloud Run 环境变量（只读）。"
      />

      {config?.warnings.map((w) => (
        <Alert key={w} type="warning" showIcon message={w} />
      ))}

      <Card title="Vultr 连接配置（MinIO / Redis / SQLite）" loading={loading && !config}>
        {config?.minio.enabled && (
          <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="对象存储后端">
              <Tag color="green">{config.policy.cacheUploadBackend}</Tag>
              <Tag>{config.policy.discountOffersPersistence}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="MinIO API 地址">
              <Typography.Text copyable>{config.minio.endpoint}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="桶名">
              <Typography.Text copyable>{config.minio.bucket}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="用户名 (Access Key)">
              <Typography.Text copyable>{config.minio.accessKeyId}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="密码 (Secret Key)">
              <Typography.Text copyable code>
                {config.minio.secretAccessKey}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="公开 CDN 基址 (App 读 cache)">
              <Typography.Text copyable>{config.minio.publicCdnBase}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="MinIO 控制台（仅 Vultr 内网）">
              <Typography.Text type="secondary">{config.minio.consoleUrlHint}（127.0.0.1:9001）</Typography.Text>
            </Descriptions.Item>
          </Descriptions>
        )}

        {config?.redis.enabled && (
          <Descriptions bordered size="small" column={1} style={{ marginBottom: 16 }}>
            <Descriptions.Item label="Redis 地址">
              {config.redis.host}:{config.redis.port}
            </Descriptions.Item>
            <Descriptions.Item label="REDIS_URL（完整）">
              <Typography.Text copyable code>
                {config.redis.url}
              </Typography.Text>
            </Descriptions.Item>
          </Descriptions>
        )}

        {config && (
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="SQLite 路径（Vultr 宿主机）">
              <Typography.Text copyable>{config.sqlite.pathOnVultrHost}</Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="应用是否已连接 SQLite">
              {config.sqlite.appConnected ? '是' : '否（预留）'}
            </Descriptions.Item>
            <Descriptions.Item label="说明">{config.sqlite.note}</Descriptions.Item>
            <Descriptions.Item label="Firestore 项目">{config.gcp.firestoreProjectId}</Descriptions.Item>
            <Descriptions.Item label="GCS 遗留配置">
              {config.gcp.gcsConfigured ? (
                <Typography.Text type="danger">
                  仍检测到 GCS 桶名（{config.gcp.gcsCacheBucket || config.gcp.videoGcsBucket}），请从 Cloud Run 移除
                </Typography.Text>
              ) : (
                <Typography.Text type="success">未配置 GCS 桶（符合大对象不上 GCP）</Typography.Text>
              )}
            </Descriptions.Item>
          </Descriptions>
        )}

        <Button type="primary" onClick={() => void load()} loading={loading} style={{ marginTop: 16 }}>
          刷新全部
        </Button>
      </Card>

      <Card title="数据存放一览">
        <Table
          size="small"
          pagination={false}
          rowKey="category"
          dataSource={config?.dataPlacement ?? []}
          columns={[
            { title: '类别', dataIndex: 'category', width: 160 },
            { title: '示例路径', dataIndex: 'examples' },
            {
              title: '主存储',
              dataIndex: 'primaryStore',
              width: 130,
              render: (v: string) => <Tag color={storeColor[v] ?? 'default'}>{v}</Tag>,
            },
            { title: '说明', dataIndex: 'notes' },
          ]}
        />
      </Card>

      <Card
        title="MinIO 对象浏览"
        extra={
          <Space>
            <Select
              value={prefix}
              style={{ width: 280 }}
              onChange={(v) => setPrefix(v)}
              options={[
                { value: 'cache/', label: 'cache/' },
                { value: 'cache/discount-offers/v1/', label: 'cache/discount-offers/v1/' },
                { value: 'videos/', label: 'videos/' },
                { value: '', label: '（全部前缀）' },
              ]}
            />
            <Button onClick={() => void refreshMinio()}>列出对象</Button>
          </Space>
        }
      >
        {minio && (
          <>
            <Typography.Paragraph type="secondary">
              桶 <Typography.Text code>{minio.bucket}</Typography.Text> 各前缀统计（最多扫描约 5 万条/前缀）：
            </Typography.Paragraph>
            <Table
              size="small"
              pagination={false}
              rowKey="prefix"
              style={{ marginBottom: 16 }}
              dataSource={minio.prefixSummary}
              columns={[
                { title: '前缀', dataIndex: 'prefix' },
                { title: '对象数', dataIndex: 'objectCount' },
                { title: '合计大小', dataIndex: 'totalBytes', render: (v: number) => formatBytes(v) },
              ]}
            />
            <Table
              size="small"
              rowKey="key"
              dataSource={minio.objects}
              pagination={{ pageSize: 20 }}
              columns={[
                { title: 'Key', dataIndex: 'key', ellipsis: true },
                { title: '大小', dataIndex: 'size', width: 100, render: (v: number) => formatBytes(v) },
                { title: '修改时间', dataIndex: 'lastModified', width: 200 },
              ]}
            />
            {minio.truncated && (
              <Typography.Text type="warning">列表已截断，请缩小前缀或提高 limit。</Typography.Text>
            )}
          </>
        )}
      </Card>

      <Card title="Redis 缓存键">
        {redis && (
          <>
            <Descriptions size="small" column={2}>
              <Descriptions.Item label="连接">
                {redis.connected ? <Tag color="success">已连接</Tag> : <Tag color="error">失败</Tag>}
              </Descriptions.Item>
              <Descriptions.Item label="键总数 (DBSIZE)">{redis.dbSize}</Descriptions.Item>
              <Descriptions.Item label="内存">{redis.memoryHuman ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="键前缀">{redis.keyPrefix}</Descriptions.Item>
            </Descriptions>
            {redis.error && <Alert type="error" message={redis.error} style={{ marginTop: 8 }} />}
            <Typography.Paragraph style={{ marginTop: 12 }}>示例键（最多 40 个）：</Typography.Paragraph>
            <Input.TextArea readOnly rows={6} value={redis.sampleKeys.join('\n') || '（暂无键）'} />
          </>
        )}
      </Card>
    </Space>
  );
}
