import { Button, Collapse, Table, Tag, Typography, message } from 'antd';
import { adminApi } from '../../api/admin';
import { useAppGamesWorkspace } from './appGamesContext';
import { GameNameCell, NAME_COL_WIDTH } from './GameNameCell';

/** 批量拉 Steam 商店详情（图文、价格元数据等） */
export function AppGamesDetailSyncPage() {
  const {
    syncingBatch,
    setSyncingBatch,
    detailSyncOffset,
    setDetailSyncOffset,
    detailCursorAppid,
    setDetailCursorAppid,
    detailSyncRows,
    setDetailSyncRows,
    setSyncJobs,
    load,
  } = useAppGamesWorkspace();

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        游戏详情同步
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        列表默认按 Steam 当前在线人数（热度）排序。热度 Top500 流水线会：刷新在线人数 → 补齐缺失详情 → 每款拉取最新 50 条评论。
        批量详情每次最多 200 条未同步项；按数字 appid 从小到大补全。Steam 无详情的 app 会标记为不可用并自动跳过。
      </Typography.Paragraph>
      <Button
        loading={syncingBatch}
        style={{ marginRight: 8, marginBottom: 8 }}
        onClick={async () => {
          setSyncingBatch(true);
          try {
            const out = await adminApi.syncTopHeatPipeline({
              topN: 500,
              delayMs: 45,
              maxReviews: 50,
              forcePlayers: true,
            });
            message.success(
              `Top500 完成：人数+${out.playersRefreshed} 详情+${out.detailsSynced} 评论+${out.reviewsLoaded}`,
            );
            void load();
          } catch (e) {
            message.error(e instanceof Error ? e.message : 'Top500 流水线失败');
          } finally {
            setSyncingBatch(false);
          }
        }}
      >
        热度 Top500（人数+详情+评论50）
      </Button>
      <Button
        loading={syncingBatch}
        style={{ marginRight: 8 }}
        type="primary"
        onClick={async () => {
          setSyncingBatch(true);
          try {
            const out = await adminApi.syncGameDetailsBatch({ batchSize: 200, delayMs: 120, concurrency: 4, force: false });
            setDetailSyncRows(out.rows);
            message.success(`详情批量同步完成: 成功${out.success}, 跳过${out.skipped}, 失败${out.failed}`);
            setDetailSyncOffset(out.nextOffset ?? 0);
            setDetailCursorAppid(out.nextCursorAppid ?? '');
            if (out.reachedEnd) setDetailCursorAppid('');
            const jobs = await adminApi.gameSyncJobs({ limit: 20 });
            setSyncJobs(jobs.rows);
            void load();
          } catch (e) {
            message.error(e instanceof Error ? e.message : '批量同步失败');
          } finally {
            setSyncingBatch(false);
          }
        }}
      >
        批量同步详情(200)
      </Button>
      <Button
        loading={syncingBatch}
        onClick={async () => {
          setSyncingBatch(true);
          try {
            const out = await adminApi.syncGameDetailsBatch({
              batchSize: 200,
              delayMs: 120,
              concurrency: 4,
              offset: detailSyncOffset,
              cursorAppid: detailCursorAppid,
              force: false,
            });
            setDetailSyncRows(out.rows);
            setDetailSyncOffset(out.nextOffset ?? detailSyncOffset);
            setDetailCursorAppid(out.nextCursorAppid ?? detailCursorAppid);
            if (out.reachedEnd) setDetailCursorAppid('');
            message.success(`继续同步完成: 成功${out.success}, 跳过${out.skipped}, 失败${out.failed}, nextOffset=${out.nextOffset}`);
            void load();
          } catch (e) {
            message.error(e instanceof Error ? e.message : '继续同步失败');
          } finally {
            setSyncingBatch(false);
          }
        }}
      >
        继续同步下一批
      </Button>

      <Collapse
        style={{ marginTop: 16 }}
        defaultActiveKey={['detailRows']}
        items={[
          {
            key: 'detailRows',
            label: `本次详情同步明细 (${detailSyncRows.length})`,
            children: (
              <Table
                size="small"
                rowKey={(r) => `${r.appid}_${r.status}`}
                dataSource={detailSyncRows}
                pagination={{ pageSize: 8 }}
                columns={[
                  { title: 'appid', dataIndex: 'appid', width: 110 },
                  {
                    title: 'name',
                    dataIndex: 'name',
                    width: NAME_COL_WIDTH,
                    ellipsis: { showTitle: false },
                    render: (t?: string) => <GameNameCell text={t} />,
                  },
                  { title: 'status', dataIndex: 'status', width: 90, render: (v: string) => <Tag>{v}</Tag> },
                  { title: 'online', dataIndex: 'currentPlayers', width: 90, render: (v?: number) => v ?? '-' },
                  { title: 'discount%', dataIndex: 'discountPercent', width: 100, render: (v?: number) => (typeof v === 'number' ? `${v}%` : '-') },
                  { title: 'priceFinal', dataIndex: 'priceFinal', width: 100, render: (v?: number) => (typeof v === 'number' ? v : '-') },
                  { title: 'message', dataIndex: 'message', ellipsis: true },
                ]}
              />
            ),
          },
        ]}
      />
    </div>
  );
}
