import { Card, Col, Row, Spin, Statistic } from 'antd';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { adminApi } from '../api/admin';
import type { DashboardStats } from '../types';

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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await adminApi.dashboardStats();
        if (!cancelled) setData(s);
      } catch {
        if (!cancelled) setData(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading || !data) return <Spin />;

  return (
    <Row gutter={[16, 16]}>
      <DashCard title="视频总数" value={data.totalVideos} to="../videos" />
      <DashCard title="Ready" value={data.readyVideos} to="../videos?status=ready" />
      <DashCard title="Failed" value={data.failedVideos} to="../videos?status=failed" />
      <DashCard title="Public" value={data.publicVideos} to="../videos?visibility=public" />
      <DashCard title="Pending jobs" value={data.pendingJobs} to="../video-jobs?status=pending" />
      <DashCard title="Running jobs" value={data.runningJobs} to="../video-jobs?status=running" />
    </Row>
  );
}
