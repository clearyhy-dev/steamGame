import { Typography } from 'antd';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

export type ItadPriceHistoryRow = {
  timestamp?: string;
  priceAmount?: number;
  currency?: string;
  shopName?: string;
};

function formatTickTime(raw: string): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return raw.length > 10 ? raw.slice(0, 10) : raw;
}

/** ITAD `games/history/v2`（Steam 店）折线，接近 ITAD 站点历史曲线 */
export function ItadPriceHistoryChart({ rows }: { rows: ItadPriceHistoryRow[] }) {
  const data = rows
    .filter((r) => typeof r.priceAmount === 'number' && Number.isFinite(r.priceAmount) && r.timestamp)
    .map((r) => ({
      t: formatTickTime(String(r.timestamp)),
      price: r.priceAmount as number,
      currency: r.currency ?? '',
    }));
  if (data.length === 0) {
    return <Typography.Text type="secondary">暂无 ITAD 价格历史点（请先对该国跑 ITAD 折扣同步）</Typography.Text>;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 16 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="t" tick={{ fontSize: 10 }} interval="preserveStartEnd" angle={-30} textAnchor="end" height={72} />
        <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
        <Tooltip formatter={(v: number) => [v, '成交价']} labelFormatter={(l) => `时间 ${l}`} />
        <Legend />
        <Line type="monotone" dataKey="price" name="ITAD 历史价" dot={false} stroke="#722ed1" strokeWidth={2} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** 按日在线人数（每次同步详情写入当天 UTC 日期） */
export function PlayersDailyChart({ rows }: { rows: Array<{ day: string; players: number }> }) {
  const data = (rows ?? [])
    .filter((r) => r && typeof r.day === 'string' && typeof r.players === 'number')
    .map((r) => ({ day: r.day, players: Math.max(0, Math.trunc(r.players)) }));
  if (data.length === 0) {
    return <Typography.Text type="secondary">暂无按日在线数据（同步游戏详情后会逐日打点）</Typography.Text>;
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="day" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 11 }} domain={['auto', 'auto']} />
        <Tooltip formatter={(v: number) => [v, '在线']} />
        <Legend />
        <Line type="monotone" dataKey="players" name="在线人数" dot stroke="#1890ff" strokeWidth={2} connectNulls />
      </LineChart>
    </ResponsiveContainer>
  );
}
