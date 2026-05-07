import { Alert, Button, Card, Col, Row, Spin, Statistic } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../api/admin';
import type { DashboardStats } from '../types';

const emptyStats: DashboardStats = {
  totalVideos: 0,
  readyVideos: 0,
  failedVideos: 0,
  publicVideos: 0,
  pendingJobs: 0,
  runningJobs: 0,
};

function DashCard({
  title,
  value,
  to,
}: {
  title: string;
  value: number;
  to: string;
}) {
  return (
    <Col xs={24} sm={12} lg={8}>
      <Link to={to} style={{ display: 'block', color: 'inherit' }}>
        <Card hoverable styles={{ body: { cursor: 'pointer' } }}>
          <Statistic title={title} value={value} />
        </Card>
      </Link>
    </Col>
  );
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const s = await adminApi.dashboardStats();
      setData(s);
    } catch (e) {
      setData(null);
      setLoadError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  if (loading && data === null) {
    return <Spin style={{ display: 'block', margin: '48px auto' }} />;
  }

  const stats = data ?? emptyStats;

  return (
    <>
      {loadError ? (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="仪表盘数据加载失败"
          description={loadError}
          action={
            <Button size="small" type="primary" onClick={() => void fetchStats()}>
              重试
            </Button>
          }
        />
      ) : null}
      <Row gutter={[16, 16]}>
        <DashCard title="视频总数" value={stats.totalVideos} to="../videos" />
        <DashCard title="Ready" value={stats.readyVideos} to="../videos?status=ready" />
        <DashCard title="Failed" value={stats.failedVideos} to="../videos?status=failed" />
        <DashCard title="Public" value={stats.publicVideos} to="../videos?visibility=public" />
        <DashCard title="Pending jobs" value={stats.pendingJobs} to="../video-jobs?status=pending" />
        <DashCard title="Running jobs" value={stats.runningJobs} to="../video-jobs?status=running" />
      </Row>
    </>
  );
}
