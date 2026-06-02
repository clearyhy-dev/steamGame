import {
  Button,
  Card,
  Descriptions,
  Image,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from 'antd';
import { Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { adminApi } from '../../api/admin';
import type { DealLinkRow } from '../../types';
import { useAppGamesWorkspace } from './appGamesContext';
import { ItadPriceHistoryChart, PlayersDailyChart, type ItadPriceHistoryRow } from './ItadAndPlayersCharts';

const DEAL_LINKS_PAGE_SIZE = 20;

function sourceSelectLabel(source: string): string {
  if (source === 'isthereanydeal') return 'ITAD';
  if (source === 'ggdeals') return 'GG.deals';
  return source;
}

export function GameDetailModal() {
  const {
    detailOpen,
    setDetailOpen,
    detailLoading,
    detail,
    dealDraft,
    setDealDraft,
    reviewsPages,
    setReviewsPages,
    openDetail,
    load,
    insightCountry,
  } = useAppGamesWorkspace();

  const [dealLinkCountryFilter, setDealLinkCountryFilter] = useState<string | undefined>();
  const [dealLinkSourceFilter, setDealLinkSourceFilter] = useState<string | undefined>();
  const [dealLinkPage, setDealLinkPage] = useState(1);

  const dealLinksAll = detail?.dealLinks ?? [];

  useEffect(() => {
    setDealLinkCountryFilter(undefined);
    setDealLinkSourceFilter(undefined);
    setDealLinkPage(1);
  }, [detail?.game?.appid]);

  useEffect(() => {
    setDealLinkPage(1);
  }, [dealLinkCountryFilter, dealLinkSourceFilter]);

  const dealLinkCountryOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of dealLinksAll) {
      const c = String(r.countryCode ?? '')
        .trim()
        .toUpperCase()
        .slice(0, 2);
      if (/^[A-Z]{2}$/.test(c)) set.add(c);
    }
    return Array.from(set)
      .sort()
      .map((v) => ({ value: v, label: v }));
  }, [dealLinksAll]);

  const dealLinkSourceOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of dealLinksAll) set.add(r.source);
    return Array.from(set)
      .sort()
      .map((v) => ({ value: v, label: sourceSelectLabel(v) }));
  }, [dealLinksAll]);

  const filteredDealLinks = useMemo(() => {
    return dealLinksAll.filter((r) => {
      if (dealLinkCountryFilter) {
        const cc = String(r.countryCode ?? '')
          .trim()
          .toUpperCase()
          .slice(0, 2);
        if (cc !== dealLinkCountryFilter) return false;
      }
      if (dealLinkSourceFilter && r.source !== dealLinkSourceFilter) return false;
      return true;
    });
  }, [dealLinksAll, dealLinkCountryFilter, dealLinkSourceFilter]);

  return (
    <Modal
      title={detail?.game?.name ? `${detail.game.name} (${detail.game.appid})` : '游戏详情'}
      open={detailOpen}
      onCancel={() => setDetailOpen(false)}
      footer={null}
      width={1080}
    >
      {detailLoading && <Typography.Text>加载中...</Typography.Text>}
      {!detailLoading && !detail && <Typography.Text type="secondary">暂无详情</Typography.Text>}
      {!detailLoading && detail && (
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Card size="small" title="基础信息">
            <Descriptions bordered size="small" column={1}>
              <Descriptions.Item label="appid">{detail.game.appid}</Descriptions.Item>
              <Descriptions.Item label="name">{detail.game.name}</Descriptions.Item>
              <Descriptions.Item label="genres">{detail.game.genres.join(', ') || '—'}</Descriptions.Item>
              <Descriptions.Item label="categories">{detail.game.categories.join(', ') || '—'}</Descriptions.Item>
              <Descriptions.Item label="tags">{detail.game.tags?.join(', ') || '—'}</Descriptions.Item>
              <Descriptions.Item label="developers">{detail.game.developers?.join(', ') || '—'}</Descriptions.Item>
              <Descriptions.Item label="publishers">{detail.game.publishers?.join(', ') || '—'}</Descriptions.Item>
              <Descriptions.Item label="description">{detail.game.shortDescription || '—'}</Descriptions.Item>
              <Descriptions.Item label="discountPercent">{detail.game.discountPercent ?? 0}%</Descriptions.Item>
              <Descriptions.Item label="clickCount">{detail.game.clickCount ?? 0}</Descriptions.Item>
              <Descriptions.Item label="折扣跳转">
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  请在下方「Deal Links」维护各渠道链接（数据在 <Typography.Text code>game_discount_offers</Typography.Text>）。
                </Typography.Text>
              </Descriptions.Item>
              {detail.reviewSummary && (
                <Descriptions.Item label="reviewSummary">
                  {detail.reviewSummary.reviewScoreDesc} · {detail.reviewSummary.positivePercent}% positive · total{' '}
                  {detail.reviewSummary.totalReviews}
                </Descriptions.Item>
              )}
            </Descriptions>
          </Card>

          <Card
            size="small"
            title={
              <Space wrap>
                <span>Deal Links（{dealLinksAll.length}）</span>
                {filteredDealLinks.length !== dealLinksAll.length ? (
                  <Typography.Text type="secondary">筛选后 {filteredDealLinks.length} 条</Typography.Text>
                ) : null}
              </Space>
            }
          >
            <Typography.Paragraph type="secondary" style={{ marginBottom: 10, fontSize: 12 }}>
              按国家（cc）与平台（source）展示的数据来自 <Typography.Text code>game_discount_offers</Typography.Text>
              （API 扁平为 deal 列表），由「实时获取折扣」或批量任务写入。
            </Typography.Paragraph>
            <Space wrap style={{ marginBottom: 10 }}>
              <Select
                value={dealDraft.source}
                onChange={(v) => setDealDraft((p) => ({ ...p, source: v }))}
                style={{ width: 130 }}
                options={[
                  { value: 'manual', label: 'manual' },
                  { value: 'affiliate', label: 'affiliate' },
                  { value: 'steam', label: 'steam' },
                  { value: 'isthereanydeal', label: 'isthereanydeal' },
                  { value: 'ggdeals', label: 'gg.deals' },
                  { value: 'cheapshark', label: 'cheapshark' },
                  { value: 'fanatical', label: 'fanatical' },
                  { value: 'cdkeys', label: 'cdkeys' },
                  { value: 'gearup', label: 'gearup' },
                ]}
              />
              <Input
                value={dealDraft.url}
                onChange={(e) => setDealDraft((p) => ({ ...p, url: e.target.value }))}
                placeholder="https://deal-link..."
                style={{ width: 380 }}
              />
              <InputNumber
                min={0}
                max={9999}
                value={dealDraft.priority}
                onChange={(v) => setDealDraft((p) => ({ ...p, priority: Number(v || 100) }))}
              />
              <Input
                placeholder="startAt ISO(optional)"
                style={{ width: 200 }}
                value={dealDraft.startAt ?? ''}
                onChange={(e) => setDealDraft((p) => ({ ...p, startAt: e.target.value }))}
              />
              <Input
                placeholder="endAt ISO(optional)"
                style={{ width: 200 }}
                value={dealDraft.endAt ?? ''}
                onChange={(e) => setDealDraft((p) => ({ ...p, endAt: e.target.value }))}
              />
              <span>affiliate</span>
              <Switch checked={dealDraft.isAffiliate} onChange={(v) => setDealDraft((p) => ({ ...p, isAffiliate: v }))} />
              <span>active</span>
              <Switch checked={dealDraft.isActive} onChange={(v) => setDealDraft((p) => ({ ...p, isActive: v }))} />
              <Button
                onClick={async () => {
                  try {
                    const out = await adminApi.syncGameDeals(detail.game.appid);
                    message.success(`实时折扣同步完成：${out.upserted}`);
                    await openDetail(detail.game.appid);
                    void load();
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : '折扣同步失败');
                  }
                }}
              >
                实时获取折扣
              </Button>
              <Button
                type="primary"
                onClick={async () => {
                  try {
                    await adminApi.createGameDealLink(detail.game.appid, dealDraft);
                    message.success('Deal link 已保存');
                    await openDetail(detail.game.appid);
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : '保存deal link失败');
                  }
                }}
              >
                添加 Deal Link
              </Button>
            </Space>
            {detail.bestDeal && (
              <Typography.Paragraph type="secondary">
                当前 best_deal: [{detail.bestDeal.source}] {detail.bestDeal.url}
              </Typography.Paragraph>
            )}
            <Space wrap align="center" style={{ marginBottom: 10 }}>
              <Typography.Text type="secondary">列表筛选</Typography.Text>
              <Select
                allowClear
                placeholder="国家 cc"
                style={{ width: 128 }}
                value={dealLinkCountryFilter}
                onChange={(v) => setDealLinkCountryFilter(v ?? undefined)}
                options={dealLinkCountryOptions}
                showSearch
                optionFilterProp="label"
              />
              <Select
                allowClear
                placeholder="平台 source"
                style={{ width: 168 }}
                value={dealLinkSourceFilter}
                onChange={(v) => setDealLinkSourceFilter(v ?? undefined)}
                options={dealLinkSourceOptions}
                showSearch
                optionFilterProp="label"
              />
            </Space>
            <Table
              rowKey="dealId"
              size="small"
              scroll={{ x: 1280 }}
              dataSource={filteredDealLinks}
              pagination={{
                current: dealLinkPage,
                pageSize: DEAL_LINKS_PAGE_SIZE,
                total: filteredDealLinks.length,
                showSizeChanger: false,
                hideOnSinglePage: filteredDealLinks.length <= DEAL_LINKS_PAGE_SIZE,
                onChange: (p) => setDealLinkPage(p),
                showTotal: (t) => `共 ${t} 条`,
              }}
              columns={[
                {
                  title: 'source',
                  dataIndex: 'source',
                  fixed: 'left',
                  width: 110,
                  render: (v: string) =>
                    v === 'isthereanydeal' ? (
                      <Tag color="purple">ITAD</Tag>
                    ) : v === 'ggdeals' ? (
                      <Tag color="cyan">GG.deals</Tag>
                    ) : (
                      v
                    ),
                },
                { title: 'cc', dataIndex: 'countryCode', fixed: 'left', width: 64, render: (v?: string) => v ?? '—' },
                {
                  title: '折扣链接',
                  key: 'dealUrl',
                  fixed: 'left',
                  width: 100,
                  render: (_: unknown, r: DealLinkRow) =>
                    r.url ? (
                      <Tooltip title={r.url}>
                        <a href={r.url} target="_blank" rel="noreferrer">
                          打开
                        </a>
                      </Tooltip>
                    ) : (
                      '—'
                    ),
                },
                {
                  title: '币种',
                  dataIndex: 'currency',
                  width: 72,
                  render: (v?: string) => (v ? v : '—'),
                },
                { title: 'orig', dataIndex: 'originalPrice', width: 90, render: (v?: number) => (typeof v === 'number' ? v : '-') },
                { title: 'final', dataIndex: 'finalPrice', width: 90, render: (v?: number) => (typeof v === 'number' ? v : '-') },
                { title: 'disc%', dataIndex: 'discountPercent', width: 90, render: (v?: number) => (typeof v === 'number' ? `${v}%` : '-') },
                { title: 'hot', dataIndex: 'hotnessScore', width: 90, render: (v?: number | null) => (typeof v === 'number' ? v : '-') },
                {
                  title: '价同步',
                  dataIndex: 'lastPriceSyncAt',
                  width: 168,
                  ellipsis: true,
                  render: (v?: string | null) => v ?? '—',
                },
                { title: 'affiliate', dataIndex: 'isAffiliate', width: 90, render: (v: boolean) => (v ? 'yes' : 'no') },
                { title: 'active', dataIndex: 'isActive', width: 80, render: (v: boolean) => (v ? 'yes' : 'no') },
                { title: 'priority', dataIndex: 'priority', width: 90 },
                {
                  title: 'op',
                  width: 210,
                  render: (_, r: DealLinkRow) => (
                    <Space>
                      <Button
                        size="small"
                        onClick={async () => {
                          try {
                            await adminApi.patchGameDealLink(detail.game.appid, r.dealId, {
                              source: r.source,
                              url: r.url,
                              isAffiliate: r.isAffiliate,
                              isActive: !r.isActive,
                              priority: r.priority,
                              startAt: r.startAt,
                              endAt: r.endAt,
                            });
                            message.success('状态已更新');
                            await openDetail(detail.game.appid);
                          } catch (e) {
                            message.error(e instanceof Error ? e.message : '更新失败');
                          }
                        }}
                      >
                        {r.isActive ? '停用' : '启用'}
                      </Button>
                      <Button
                        size="small"
                        onClick={async () => {
                          try {
                            await adminApi.patchGameDealLink(detail.game.appid, r.dealId, {
                              source: r.source,
                              url: r.url,
                              isAffiliate: r.isAffiliate,
                              isActive: r.isActive,
                              priority: Math.max(0, r.priority - 10),
                              startAt: r.startAt,
                              endAt: r.endAt,
                            });
                            message.success('优先级已提升');
                            await openDetail(detail.game.appid);
                          } catch (e) {
                            message.error(e instanceof Error ? e.message : '更新失败');
                          }
                        }}
                      >
                        提升优先级
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>

          {(() => {
            const cc = (insightCountry || 'US').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
            if (!/^[A-Z]{2}$/.test(cc) || !detail.game.byCountry?.[cc]) return null;
            const bucket = detail.game.byCountry[cc] as Record<string, unknown>;
            const itadDetail = bucket.itadDetail as { priceHistory?: ItadPriceHistoryRow[]; itadApiCountry?: string } | undefined;
            const itadSnap = bucket.isthereanydeal as {
              finalPrice?: number;
              originalPrice?: number;
              currency?: string;
              discountPercent?: number;
              url?: string;
            } | undefined;
            const priceHistory = Array.isArray(itadDetail?.priceHistory) ? itadDetail.priceHistory : [];
            const apiC = itadDetail?.itadApiCountry;
            return (
              <Card
                size="small"
                title={`ITAD 分析（分桶国 ${cc}${apiC ? ` · ITAD API 国 ${apiC}` : ''}）`}
              >
                <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                  <Space wrap align="center">
                    <Tag color="purple">ITAD 折扣价</Tag>
                    {typeof itadSnap?.finalPrice === 'number' ? (
                      <Typography.Text>
                        {itadSnap.finalPrice} {itadSnap.currency ?? ''}
                        {typeof itadSnap.originalPrice === 'number' ? ` · 原价 ${itadSnap.originalPrice}` : ''}
                        {typeof itadSnap.discountPercent === 'number' ? ` · −${itadSnap.discountPercent}%` : ''}
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="secondary">该分桶尚无 ITAD 价（请对该国跑 ITAD 折扣同步）</Typography.Text>
                    )}
                    {itadSnap?.url ? (
                      <a href={itadSnap.url} target="_blank" rel="noreferrer">
                        打开 ITAD 购买链接
                      </a>
                    ) : null}
                  </Space>
                  <div>
                    <Typography.Text strong>历史价格（ITAD / Steam 店，近似官网曲线）</Typography.Text>
                    <ItadPriceHistoryChart rows={priceHistory} />
                  </div>
                  <div>
                    <Typography.Text strong>
                      在线人数（按日，UTC；由「周热度同步」写入{' '}
                      <Typography.Text code>game_weekly_heat</Typography.Text>）
                    </Typography.Text>
                    <PlayersDailyChart rows={detail.game.weeklyHeat?.playersDaily ?? []} />
                  </div>
                </Space>
              </Card>
            );
          })()}

          {(() => {
            const cc = (insightCountry || 'US').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2);
            if (!/^[A-Z]{2}$/.test(cc) || !detail.game.byCountry?.[cc]) return null;
            const bucket = detail.game.byCountry[cc] as Record<string, unknown>;
            const gd = bucket.ggDetail as {
              ggApiRegion?: string;
              priceSyncOk?: boolean;
              chartNote?: string;
              prices?: {
                currentRetail?: number;
                currentKeyshops?: number;
                historicalRetail?: number;
                historicalKeyshops?: number;
                currency?: string;
                lowestCurrentSource?: 'retail' | 'keyshop';
              };
              trendScore?: number;
              hotToday?: boolean;
              trending?: boolean;
              rising?: boolean;
              recentAttention?: boolean;
              playerRatingPercent?: number;
              playerRatingLabel?: string;
            } | undefined;
            const ggSnap = bucket.ggdeals as {
              finalPrice?: number;
              currency?: string;
              discountPercent?: number;
              url?: string;
            } | undefined;
            if (!gd && !ggSnap?.url) return null;
            return (
              <Card size="small" title={`GG.deals（分桶国 ${cc}${gd?.ggApiRegion ? ` · region ${gd.ggApiRegion}` : ''}）`}>
                <Space direction="vertical" size="small" style={{ width: '100%' }}>
                  <Space wrap align="center">
                    <Tag color="cyan">GG 现价</Tag>
                    {typeof ggSnap?.finalPrice === 'number' ? (
                      <Typography.Text>
                        {ggSnap.finalPrice} {ggSnap.currency ?? ''}
                        {typeof ggSnap.discountPercent === 'number' ? ` · −${ggSnap.discountPercent}%` : ''}
                      </Typography.Text>
                    ) : (
                      <Typography.Text type="secondary">暂无 GG 价（请跑 GG 折扣同步）</Typography.Text>
                    )}
                    {ggSnap?.url ? (
                      <a href={String(ggSnap.url)} target="_blank" rel="noreferrer">
                        打开 GG 链接（含 region）
                      </a>
                    ) : null}
                  </Space>
                  {gd ? (
                    <>
                      {gd.priceSyncOk === false ? (
                        <Typography.Text type="secondary">上次 GG 价格接口未成功</Typography.Text>
                      ) : null}
                      {gd.prices ? (
                        <Typography.Text style={{ fontSize: 12, display: 'block', whiteSpace: 'pre-wrap' }}>
                          {(() => {
                            const c = gd.prices.currency ?? '';
                            const row = (label: string, cur?: number, hist?: number) =>
                              `${label}: 现价 ${cur != null ? `${cur} ${c}`.trim() : '—'} · 史低 ${hist != null ? `${hist} ${c}`.trim() : '—'}`;
                            return [row('零售', gd.prices.currentRetail, gd.prices.historicalRetail), row('Keyshop', gd.prices.currentKeyshops, gd.prices.historicalKeyshops)].join(
                              '\n',
                            );
                          })()}
                          {gd.prices.lowestCurrentSource ? ` · 低价侧: ${gd.prices.lowestCurrentSource}` : ''}
                        </Typography.Text>
                      ) : null}
                      {gd.chartNote ? (
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                          {gd.chartNote}
                        </Typography.Text>
                      ) : null}
                      {gd.hotToday || gd.trending || gd.rising || gd.recentAttention || gd.trendScore != null ? (
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                          （以下为旧版缓存字段，新同步已不再写入）
                          {gd.trendScore != null ? ` 热度分 ${gd.trendScore}` : ''}
                        </Typography.Text>
                      ) : null}
                    </>
                  ) : null}
                </Space>
              </Card>
            );
          })()}

          <Card size="small" title={`同步资源（固定值）`}>
            <Space wrap>
              <Button
                onClick={async () => {
                  try {
                    await adminApi.syncGameDetail(detail.game.appid);
                    message.success('已同步详情到服务器');
                    await openDetail(detail.game.appid);
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : '同步失败');
                  }
                }}
              >
                同步图片/视频
              </Button>
              <InputNumber min={1} max={200} value={reviewsPages} onChange={(v) => setReviewsPages(Number(v || 20))} />
              <Button
                type="primary"
                onClick={async () => {
                  try {
                    const out = await adminApi.loadGameReviews(detail.game.appid, { maxReviews: 50 });
                    message.success(`评论手动加载完成：${out.reviewCount}`);
                    await openDetail(detail.game.appid);
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : '评论加载失败');
                  }
                }}
              >
                手动加载评论
              </Button>
            </Space>
          </Card>

          <Card size="small" title={`关联视频 (${detail.videos.length})`}>
            <Table
              size="small"
              rowKey="videoId"
              pagination={{ pageSize: 6 }}
              dataSource={detail.videos}
              columns={[
                { title: 'videoId', dataIndex: 'videoId', width: 140, ellipsis: true },
                { title: 'title', dataIndex: 'title', ellipsis: true },
                { title: 'status', dataIndex: 'status', width: 100, render: (v: string) => <Tag>{v}</Tag> },
                {
                  title: 'op',
                  width: 90,
                  render: (_, r) => <Link to={`/videos/${r.videoId}`}>详情</Link>,
                },
              ]}
            />
          </Card>

          {detail.game.screenshots?.length > 0 && (
            <Card size="small" title={`截图 (${detail.game.screenshots.length})`}>
              <Space wrap>
                {detail.game.screenshots.slice(0, 20).map((u) => (
                  <Image key={u} src={u} width={140} />
                ))}
              </Space>
            </Card>
          )}

          {detail.game.trailerUrls?.length > 0 && (
            <Card size="small" title={`视频链接 (${detail.game.trailerUrls.length})`}>
              <Space direction="vertical" style={{ width: '100%' }}>
                {detail.game.trailerUrls.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer">
                    {u}
                  </a>
                ))}
              </Space>
            </Card>
          )}

          <Card size="small" title={`评论 (${detail.reviews.length})`}>
            <Table
              size="small"
              rowKey={(r) => `${r.reviewId}_${r.timestampCreated}`}
              pagination={{ pageSize: 8 }}
              dataSource={detail.reviews}
              columns={[
                { title: 'time', dataIndex: 'timestampCreated', width: 160, render: (v: number) => new Date(v * 1000).toISOString() },
                { title: 'author', dataIndex: 'authorSteamId', width: 150, ellipsis: true },
                { title: 'lang', dataIndex: 'language', width: 80 },
                { title: 'votes', dataIndex: 'votesUp', width: 80 },
                { title: 'votedUp', dataIndex: 'votedUp', width: 90, render: (v: boolean) => (v ? 'yes' : 'no') },
                { title: 'content', dataIndex: 'content', ellipsis: true },
              ]}
            />
          </Card>
        </Space>
      )}
    </Modal>
  );
}
