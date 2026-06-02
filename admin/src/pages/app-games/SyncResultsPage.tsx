import { Collapse, Table, Tag, Typography } from 'antd';
import { useAppGamesWorkspace } from './appGamesContext';

/** 最近一次批量折扣的平台覆盖率与逐条结果 */
export function AppGamesSyncResultsPage() {
  const { dealCoverage, dealBatchRows, dealBatchMeta } = useAppGamesWorkspace();

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        同步结果
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        展示「折扣同步」页最近一次任务产出的覆盖率与明细；切换页面后数据仍保留在当前浏览器会话内。
      </Typography.Paragraph>

      <Collapse
        defaultActiveKey={['coverage', 'dealBatchRows']}
        items={[
          {
            key: 'coverage',
            label: '平台覆盖率（最近一次批量折扣）',
            children: (
              <Table
                size="small"
                rowKey={(r) => r.source}
                pagination={false}
                dataSource={dealCoverage}
                columns={[
                  { title: 'platform', dataIndex: 'source', width: 140 },
                  { title: 'success', dataIndex: 'ok', width: 100 },
                  { title: 'empty', dataIndex: 'empty', width: 100 },
                  { title: 'failed', dataIndex: 'failed', width: 100 },
                ]}
              />
            ),
          },
          {
            key: 'dealBatchRows',
            label: `折扣批量抓取明细（${dealBatchRows.length} 条）`,
            children: (
              <>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  batchSize={dealBatchMeta.requestedBatchSize ?? '-'} | cursorStart={dealBatchMeta.cursorStart ?? '-'} | cursorEnd=
                  {dealBatchMeta.cursorEnd ?? '-'}
                </Typography.Paragraph>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  staleMarked={dealBatchMeta.staleMarked ?? 0} | staleScanned={dealBatchMeta.staleScanned ?? 0}
                </Typography.Paragraph>
                <Table
                  size="small"
                  rowKey={(r) => r.appid}
                  pagination={{ pageSize: 10 }}
                  dataSource={dealBatchRows}
                  columns={[
                    { title: 'appid', dataIndex: 'appid', width: 100 },
                    { title: 'name', dataIndex: 'name', width: 240, ellipsis: true },
                    {
                      title: 'status',
                      dataIndex: 'ok',
                      width: 90,
                      render: (v: boolean) => (v ? <Tag color="green">ok</Tag> : <Tag color="red">fail</Tag>),
                    },
                    { title: 'upserted', dataIndex: 'upserted', width: 90 },
                    { title: 'inserted', dataIndex: 'inserted', width: 90 },
                    { title: 'updated', dataIndex: 'updated', width: 90 },
                    { title: 'deduped', dataIndex: 'deduped', width: 90 },
                    { title: 'message', dataIndex: 'message', ellipsis: true },
                  ]}
                />
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
