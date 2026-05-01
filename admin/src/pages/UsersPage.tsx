import { Button, Input, Modal, Select, Space, Switch, Table, Tag, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../api/admin';
import type { AdminUserRow } from '../types';

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
      width: 220,
      render: (_, r) => (
        <Space wrap>
          <Button size="small" onClick={() => openEdit(r)}>
            编辑
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
    </div>
  );
}

