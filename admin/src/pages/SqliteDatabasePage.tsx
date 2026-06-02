import {
  Alert,
  Button,
  Descriptions,
  Drawer,
  Form,
  Input,
  Layout,
  Space,
  Spin,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { DatabaseOutlined, EditOutlined, SearchOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { adminApi } from '../api/admin';
import type { SqliteColumnMeta, SqliteDbInfo, SqliteTableMeta } from '../types';
const { Sider, Content } = Layout;

function cellPreview(v: unknown): string {
  if (v === null || v === undefined) return '—';
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > 120 ? `${s.slice(0, 120)}…` : s;
}

function SqliteTableBrowser() {
  const [info, setInfo] = useState<SqliteDbInfo | null>(null);
  const [tables, setTables] = useState<SqliteTableMeta[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [columns, setColumns] = useState<SqliteColumnMeta[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [loadingRows, setLoadingRows] = useState(false);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState<number | undefined>();
  const [limit] = useState(50);
  const [editOpen, setEditOpen] = useState(false);
  const [editRow, setEditRow] = useState<Record<string, unknown> | null>(null);
  const [form] = Form.useForm<Record<string, string>>();

  const tableMeta = useMemo(
    () => tables.find((t) => t.name === selectedTable) ?? null,
    [tables, selectedTable],
  );

  const loadMeta = useCallback(async () => {
    setLoadingInfo(true);
    try {
      const [inf, tbl] = await Promise.all([adminApi.sqliteInfo(), adminApi.sqliteTables()]);
      setInfo(inf);
      setTables(tbl.tables);
      setSelectedTable((prev) => prev ?? (tbl.tables[0]?.name ?? null));
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoadingInfo(false);
    }
  }, []);

  const loadRows = useCallback(async () => {
    if (!selectedTable) return;
    setLoadingRows(true);
    try {
      const params: Record<string, string | number> = { limit, offset };
      for (const [k, v] of Object.entries(filters)) {
        if (v.trim()) params[k] = v.trim();
      }
      const schema = await adminApi.sqliteTableSchema(selectedTable);
      setColumns(schema.columns);
      const out = await adminApi.sqliteTableRows(selectedTable, params);
      setRows(out.rows);
      setTotal(out.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '查询失败');
    } finally {
      setLoadingRows(false);
    }
  }, [selectedTable, filters, limit, offset]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    setOffset(0);
    setFilters({});
  }, [selectedTable]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const pkCols = tableMeta?.primaryKeyColumns ?? columns.filter((c) => c.pk > 0).map((c) => c.name);

  const openEdit = (row: Record<string, unknown>) => {
    setEditRow(row);
    const initial: Record<string, string> = {};
    for (const col of columns) {
      if (pkCols.includes(col.name)) continue;
      const v = row[col.name];
      if (v === null || v === undefined) initial[col.name] = '';
      else if (col.name === 'data_json' || col.name.endsWith('_json')) {
        try {
          initial[col.name] = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
        } catch {
          initial[col.name] = String(v);
        }
      } else initial[col.name] = String(v);
    }
    form.setFieldsValue(initial);
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!selectedTable || !editRow || pkCols.length === 0) return;
    try {
      const values = await form.validateFields();
      const primaryKey: Record<string, unknown> = {};
      for (const k of pkCols) {
        primaryKey[k] = editRow[k];
      }
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(values)) {
        const orig = editRow[k];
        const origStr =
          orig === null || orig === undefined
            ? ''
            : k === 'data_json' || k.endsWith('_json')
              ? typeof orig === 'string'
                ? orig
                : JSON.stringify(orig)
              : String(orig);
        if (String(v ?? '') !== origStr) {
          patch[k] = v;
        }
      }
      if (Object.keys(patch).length === 0) {
        message.info('无修改');
        return;
      }
      const out = await adminApi.sqliteUpdateRow(selectedTable, { primaryKey, patch });
      message.success(`已更新 ${out.changes} 行`);
      setEditOpen(false);
      void loadRows();
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return;
      message.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  const tableCols: ColumnsType<Record<string, unknown>> = [
    ...columns.slice(0, 8).map((col) => ({
      title: col.pk > 0 ? `${col.name} (PK)` : col.name,
      dataIndex: col.name,
      key: col.name,
      ellipsis: true,
      width: col.name === 'data_json' ? 220 : undefined,
      render: (v: unknown) => cellPreview(v),
    })),
    {
      title: '操作',
      key: 'actions',
      fixed: 'right' as const,
      width: 88,
      render: (_, row) => (
        <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} disabled={pkCols.length === 0}>
          编辑
        </Button>
      ),
    },
  ];

  if (loadingInfo && !info) {
    return <Spin />;
  }

  if (info && info.dataStore !== 'vultr_sqlite') {
    return (
      <Alert
        type="warning"
        showIcon
        message="当前未使用 SQLite 存储"
        description={`DATA_STORE=${info.dataStore}。请将服务端配置为 vultr_sqlite 并设置 SQLITE_API_URL 后使用本功能。`}
      />
    );
  }

  return (
    <div>
      {info && (
        <Descriptions size="small" bordered column={2} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="存储">vultr_sqlite</Descriptions.Item>
          <Descriptions.Item label="Data API">{info.sqliteApiUrl}</Descriptions.Item>
          <Descriptions.Item label="表数量">{info.tableCount}</Descriptions.Item>
          <Descriptions.Item label="game_catalog 行数">{info.gameCatalogCount ?? '—'}</Descriptions.Item>
        </Descriptions>
      )}

      <Layout style={{ background: 'transparent', minHeight: 480 }}>
        <Sider width={220} theme="light" style={{ borderRight: '1px solid #f0f0f0', paddingRight: 8 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
            数据表
          </Typography.Text>
          <div style={{ maxHeight: 'calc(100vh - 280px)', overflow: 'auto' }}>
            {tables.map((t) => (
              <div
                key={t.name}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedTable(t.name)}
                onKeyDown={(e) => e.key === 'Enter' && setSelectedTable(t.name)}
                style={{
                  padding: '8px 10px',
                  marginBottom: 4,
                  borderRadius: 6,
                  cursor: 'pointer',
                  background: selectedTable === t.name ? '#e6f4ff' : undefined,
                }}
              >
                <Typography.Text strong={selectedTable === t.name}>{t.name}</Typography.Text>
                <div>
                  <Tag style={{ marginTop: 4 }}>{t.columnCount} 列</Tag>
                  {t.hasDataJson && <Tag color="blue">JSON</Tag>}
                </div>
              </div>
            ))}
          </div>
        </Sider>

        <Content style={{ paddingLeft: 16, minWidth: 0 }}>
          {selectedTable && tableMeta && (
            <>
              <Typography.Title level={5} style={{ marginTop: 0 }}>
                {selectedTable}
                {tableMeta.primaryKeyColumns.length > 0 && (
                  <Typography.Text type="secondary" style={{ fontSize: 13, marginLeft: 8 }}>
                    PK: {tableMeta.primaryKeyColumns.join(', ')}
                  </Typography.Text>
                )}
              </Typography.Title>

              <Space wrap style={{ marginBottom: 12 }}>
                {tableMeta.filterableColumns.map((col) => (
                  <Input
                    key={col}
                    addonBefore={col}
                    placeholder="精确匹配"
                    value={filters[col] ?? ''}
                    onChange={(e) => setFilters((prev) => ({ ...prev, [col]: e.target.value }))}
                    style={{ width: 200 }}
                    allowClear
                  />
                ))}
                <Button type="primary" icon={<SearchOutlined />} onClick={() => { setOffset(0); void loadRows(); }}>
                  查询
                </Button>
                <Button
                  onClick={() => {
                    setFilters({});
                    setOffset(0);
                  }}
                >
                  清空
                </Button>
              </Space>

              <Table
                rowKey={(r) => pkCols.map((k) => String(r[k] ?? '')).join('|') || JSON.stringify(r)}
                size="small"
                loading={loadingRows}
                columns={tableCols}
                dataSource={rows}
                scroll={{ x: 'max-content' }}
                pagination={{
                  pageSize: limit,
                  current: Math.floor(offset / limit) + 1,
                  total: total ?? (rows.length < limit ? offset + rows.length : offset + limit + 1),
                  showSizeChanger: false,
                  showTotal: total != null ? (t) => `共 ${t} 条` : undefined,
                  onChange: (page) => setOffset((page - 1) * limit),
                }}
              />
            </>
          )}
        </Content>
      </Layout>

      <Drawer
        title={`编辑行 · ${selectedTable}`}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        width={560}
        extra={
          <Button type="primary" onClick={() => void saveEdit()}>
            保存
          </Button>
        }
      >
        <Form form={form} layout="vertical">
          {pkCols.map((k) => (
            <Form.Item key={`pk-${k}`} label={`${k} (主键)`}>
              <Input value={String(editRow?.[k] ?? '')} disabled />
            </Form.Item>
          ))}
          {columns
            .filter((c) => !pkCols.includes(c.name))
            .map((col) => (
              <Form.Item
                key={col.name}
                name={col.name}
                label={
                  <span>
                    {col.name} <Typography.Text type="secondary">({col.type})</Typography.Text>
                  </span>
                }
                rules={
                  col.name === 'data_json' || col.name.endsWith('_json')
                    ? [
                        {
                          validator: async (_, val) => {
                            if (!val || !String(val).trim()) return;
                            JSON.parse(String(val));
                          },
                          message: '必须是合法 JSON',
                        },
                      ]
                    : undefined
                }
              >
                {col.name === 'data_json' || col.name.endsWith('_json') || String(col.type).toUpperCase().includes('TEXT') ? (
                  <Input.TextArea rows={col.name === 'data_json' ? 12 : 4} style={{ fontFamily: 'monospace', fontSize: 12 }} />
                ) : (
                  <Input />
                )}
              </Form.Item>
            ))}
        </Form>
      </Drawer>
    </div>
  );
}

export function SqliteDatabasePage() {
  return (
    <div>
      <Typography.Title level={4} style={{ marginTop: 0 }}>
        <DatabaseOutlined style={{ marginRight: 8 }} />
        SQLite 数据库管理
      </Typography.Title>
      <Typography.Paragraph type="secondary">
        管理项目启动时通过 <Typography.Text code>SQLITE_API_URL</Typography.Text> 连接的 SQLite 库。支持按主键/ID
        查询与字段修改；请勿在大表上无筛选翻页。需求说明见仓库 <Typography.Text code>docs/SQLITE_ADMIN_REQUIREMENTS.md</Typography.Text>。
      </Typography.Paragraph>

      <SqliteTableBrowser />
    </div>
  );
}
