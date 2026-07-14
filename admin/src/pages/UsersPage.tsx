import { Button, Input, Modal, Select, Space, Switch, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../api/admin';
import type { AdminUserRow, AdminUserFavoriteRow } from '../types';

function formatCountryCell(u: AdminUserRow) {
  const current = u.countryCode ?? u.effectiveCountryCode;
  if (!current) return <Tag>—</Tag>;
  if (u.countrySwitched && u.defaultCountryCode && u.defaultCountryCode !== current) {
    return (
      <Space direction="vertical" size={0}>
        <Tag color="orange">{current}（已切换）</Tag>
        <span style={{ fontSize: 12, color: '#888' }}>默认 {u.defaultCountryCode}</span>
      </Space>
    );
  }
  return (
    <Space direction="vertical" size={0}>
      <Tag color="blue">{current}</Tag>
      <span style={{ fontSize: 12, color: '#888' }}>默认</span>
    </Space>
  );
}

export function UsersPage() {
  const [rows, setRows] = useState<AdminUserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState<'google' | 'steam' | undefined>();
  const [keyword, setKeyword] = useState('');
  const [editing, setEditing] = useState<AdminUserRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editNote, setEditNote] = useState('');
  const [editDisabled, setEditDisabled] = useState(false);
  const [editRegisteredAt, setEditRegisteredAt] = useState('');
  const [favUser, setFavUser] = useState<AdminUserRow | null>(null);
  const [favLoading, setFavLoading] = useState(false);
  const [favCountry, setFavCountry] = useState<string | undefined>();
  const [favItems, setFavItems] = useState<AdminUserFavoriteRow[]>([]);
  const [favMeta, setFavMeta] = useState<{
    countryCode: string | null;
    currency: string | null;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi.users({
        provider,
        keyword: keyword.trim() || undefined,
      });
      setRows(data);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载用户失败');
    } finally {
      setLoading(false);
    }
  }, [provider, keyword]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEdit = (u: AdminUserRow) => {
    setEditing(u);
    setEditName(u.displayName || '');
    setEditEmail(u.email || '');
    setEditNote(u.adminNote || '');
    setEditDisabled(!!u.disabled);
    setEditRegisteredAt((u.registeredAt || '').replace('Z', ''));
  };

  const loadFavorites = useCallback(async (u: AdminUserRow, country?: string) => {
    setFavLoading(true);
    try {
      const data = await adminApi.userFavorites(u.id, country);
      setFavItems(data.items);
      setFavMeta({ countryCode: data.countryCode, currency: data.currency });
      setFavCountry(data.countryCode ?? undefined);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载愿望清单失败');
    } finally {
      setFavLoading(false);
    }
  }, []);

  const openFavorites = (u: AdminUserRow) => {
    setFavUser(u);
    setFavItems([]);
    setFavMeta(null);
    setFavCountry(u.effectiveCountryCode ?? u.countryCode ?? undefined);
    void loadFavorites(u, u.effectiveCountryCode ?? u.countryCode ?? undefined);
  };

  const favCols: ColumnsType<AdminUserFavoriteRow> = [
    { title: 'appid', dataIndex: 'appid', width: 100 },
    { title: '名称', dataIndex: 'name', ellipsis: true },
    {
      title: '折扣',
      dataIndex: 'discountPercent',
      width: 80,
      render: (v: number | null) => (v != null && v > 0 ? `${v}%` : '—'),
    },
    {
      title: '货币',
      dataIndex: 'currency',
      width: 70,
      render: (v: string | null) => v ?? '—',
    },
    { title: '来源', dataIndex: 'source', width: 90 },
    { title: '添加时间', dataIndex: 'createdAt', width: 180 },
  ];

  const cols: ColumnsType<AdminUserRow> = [
    { title: 'userId', dataIndex: 'id', width: 180, ellipsis: true },
    { title: 'displayName', dataIndex: 'displayName', width: 140, ellipsis: true },
    { title: 'email', dataIndex: 'email', width: 220, ellipsis: true },
    {
      title: 'providers',
      dataIndex: 'authProviders',
      width: 160,
      render: (ps: string[]) => (
        <Space wrap>
          {(ps ?? []).map((p) => (
            <Tag key={p} color={p === 'steam' ? 'purple' : 'blue'}>
              {p}
            </Tag>
          ))}
        </Space>
      ),
    },
    { title: 'steamId', dataIndex: 'steamId', width: 170, ellipsis: true },
    { title: 'steamName', dataIndex: 'steamPersonaName', width: 160, ellipsis: true },
    {
      title: '国家',
      key: 'country',
      width: 130,
      render: (_, r) => formatCountryCell(r),
    },
    {
      title: 'registeredAt',
      dataIndex: 'registeredAt',
      width: 180,
    },
    {
      title: 'disabled',
      dataIndex: 'disabled',
      width: 90,
      render: (v: boolean) => (v ? <Tag color="red">yes</Tag> : <Tag color="green">no</Tag>),
    },
    { title: 'updatedAt', dataIndex: 'updatedAt', width: 180 },
    {
      title: '操作',
      key: 'op',
      width: 280,
      render: (_, r) => (
        <Space wrap>
          <Button size="small" onClick={() => openEdit(r)}>
            编辑
          </Button>
          <Button size="small" onClick={() => openFavorites(r)}>
            愿望清单
          </Button>
          <Button
            size="small"
            onClick={async () => {
              if (!r.steamId) {
                message.warning('该用户未绑定 Steam');
                return;
              }
              try {
                const out = await adminApi.syncSteamUser(r.steamId);
                message.success(`同步完成 owned=${out.ownedGameCount}, recent=${out.recentTotalCount}`);
              } catch (e) {
                message.error(e instanceof Error ? e.message : '同步失败');
              }
            }}
          >
            同步 Steam
          </Button>
          <Button
            size="small"
            danger
            onClick={async () => {
              try {
                await adminApi.patchUser(r.id, { unbindSteam: true });
                message.success('已解绑 Steam');
                void load();
              } catch (e) {
                message.error(e instanceof Error ? e.message : '解绑失败');
              }
            }}
          >
            解绑 Steam
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select
          allowClear
          value={provider}
          placeholder="provider"
          style={{ width: 160 }}
          onChange={(v) => setProvider(v)}
          options={[
            { value: 'google', label: 'google' },
            { value: 'steam', label: 'steam' },
          ]}
        />
        <Input
          placeholder="keyword(id/email/name/steamId)"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          style={{ width: 280 }}
        />
        <Button onClick={() => void load()}>刷新</Button>
      </Space>

      <Table rowKey="id" loading={loading} columns={cols} dataSource={rows} scroll={{ x: true }} />

      <Modal
        title="编辑用户"
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={async () => {
          if (!editing) return;
          setSaving(true);
          try {
            await adminApi.patchUser(editing.id, {
              displayName: editName,
              email: editEmail,
              adminNote: editNote,
              disabled: editDisabled,
              registeredAt: editRegisteredAt,
            });
            message.success('已保存');
            setEditing(null);
            void load();
          } catch (e) {
            message.error(e instanceof Error ? e.message : '保存失败');
          } finally {
            setSaving(false);
          }
        }}
        confirmLoading={saving}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="displayName" />
          <Input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="email" />
          <Input.TextArea value={editNote} onChange={(e) => setEditNote(e.target.value)} placeholder="adminNote" rows={3} />
          <Input
            value={editRegisteredAt}
            onChange={(e) => setEditRegisteredAt(e.target.value)}
            placeholder="registeredAt (ISO, e.g. 2026-04-30T00:00:00.000Z)"
          />
          <Space>
            <span>disabled</span>
            <Switch checked={editDisabled} onChange={setEditDisabled} />
          </Space>
        </Space>
      </Modal>

      <Modal
        title={favUser ? `愿望清单 — ${favUser.displayName || favUser.email || favUser.id}` : '愿望清单'}
        open={!!favUser}
        onCancel={() => setFavUser(null)}
        footer={null}
        width={900}
      >
        <Space wrap style={{ marginBottom: 12 }}>
          <Input
            placeholder="国家代码 (如 CN、US)"
            value={favCountry ?? ''}
            onChange={(e) => setFavCountry(e.target.value.toUpperCase() || undefined)}
            style={{ width: 140 }}
            maxLength={2}
          />
          <Button
            onClick={() => {
              if (!favUser) return;
              void loadFavorites(favUser, favCountry);
            }}
          >
            按国家查询价格
          </Button>
          {favMeta?.countryCode ? (
            <Tag color="blue">
              价格区 {favMeta.countryCode}
              {favMeta.currency ? ` / ${favMeta.currency}` : ''}
            </Tag>
          ) : null}
          {favUser?.countrySwitched && favUser.defaultCountryCode ? (
            <Tag color="orange">
              用户已切换：默认 {favUser.defaultCountryCode} → 当前 {favUser.countryCode}
            </Tag>
          ) : favUser?.countryCode ? (
            <Tag>用户当前国家 {favUser.countryCode}</Tag>
          ) : null}
        </Space>
        <Table
          rowKey="appid"
          loading={favLoading}
          columns={favCols}
          dataSource={favItems}
          pagination={{ pageSize: 20 }}
          scroll={{ x: true }}
          locale={{ emptyText: '暂无愿望清单' }}
        />
      </Modal>
    </div>
  );
}

