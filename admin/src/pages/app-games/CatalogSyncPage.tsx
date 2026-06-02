import { Button, Table, Tag, Typography, message } from 'antd';
import { adminApi } from '../../api/admin';
import { useAppGamesWorkspace } from './appGamesContext';

/** Steam AppList 导入 + 同步任务记录 */
export function AppGamesCatalogSyncPage() {
  const { appListCursor, setAppListCursor, syncJobs, setSyncJobs, load } = useAppGamesWorkspace();

  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        Steam 目录同步
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        从 Steam 拉取全量 app 列表写入目录；与单游戏详情、折扣无关。可多次「继续导入」直至 hasMore=false。
      </Typography.Paragraph>
      <Button
        style={{ marginRight: 8 }}
        onClick={async () => {
          try {
            const out = await adminApi.syncAppList({ chunkSize: 400 });
            setAppListCursor(out.nextLastAppId ?? 0);
            message.success(`AppList同步: +${out.inserted}, 更新${out.updated}, hasMore=${out.hasMore}`);
            const jobs = await adminApi.gameSyncJobs({ limit: 20 });
            setSyncJobs(jobs.rows);
            void load();
          } catch (e) {
            message.error(e instanceof Error ? e.message : 'AppList同步失败');
          }
        }}
      >
        同步 Steam AppList
      </Button>
      <Button
        onClick={async () => {
          try {
            const out = await adminApi.syncAppList({ chunkSize: 400, maxResults: 5000, lastAppId: appListCursor });
            setAppListCursor(out.nextLastAppId ?? appListCursor);
            message.success(`继续导入: +${out.inserted}, 更新${out.updated}, hasMore=${out.hasMore}`);
            void load();
          } catch (e) {
            message.error(e instanceof Error ? e.message : '继续导入失败');
          }
        }}
      >
        继续导入下一批 AppList
      </Button>

      <Typography.Title level={5} style={{ marginTop: 24 }}>
        Steam 同步任务记录
      </Typography.Title>
      <Table
        size="small"
        rowKey="jobId"
        pagination={{ pageSize: 8 }}
        dataSource={syncJobs}
        columns={[
          { title: 'time', dataIndex: 'createdAt', width: 180 },
          { title: 'trigger', dataIndex: 'trigger', width: 150 },
          { title: 'status', dataIndex: 'status', width: 100, render: (v: string) => <Tag>{v}</Tag> },
          { title: 'appList +new', dataIndex: 'appListInserted', width: 110 },
          { title: 'detail ok/fail', width: 130, render: (_, r) => `${r.detailSuccess}/${r.detailFailed}` },
          { title: 'elapsed(ms)', dataIndex: 'elapsedMs', width: 120 },
        ]}
      />
    </div>
  );
}
