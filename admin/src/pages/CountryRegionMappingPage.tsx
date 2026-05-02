import { Button, Card, Form, Input, InputNumber, Modal, Space, Switch, Table, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../api/admin';

type Row = {
  countryCode: string;
  countryName: string;
  nativeName?: string;
  steamCc: string;
  steamLanguage: string;
  defaultCurrency: string;
  currencySymbol: string;
  enabled: boolean;
  sortOrder: number;
};

export function CountryRegionMappingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form] = Form.useForm();

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = (await adminApi.regionCountriesList()) as Row[];
      setRows(list);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onSubmit = async () => {
    try {
      const v = await form.validateFields();
      await adminApi.regionCountriesUpsert({
        countryCode: String(v.countryCode).trim().toUpperCase(),
        countryName: String(v.countryName).trim(),
        nativeName: v.nativeName != null ? String(v.nativeName) : '',
        steamCc: String(v.steamCc).trim().toUpperCase(),
        steamLanguage: String(v.steamLanguage).trim().toLowerCase(),
        defaultCurrency: String(v.defaultCurrency).trim().toUpperCase(),
        currencySymbol: String(v.currencySymbol ?? '').trim(),
        enabled: !!v.enabled,
        sortOrder: Number(v.sortOrder ?? 500),
      });
      message.success('已保存');
      setOpen(false);
      await reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  const columns: ColumnsType<Row> = [
    { title: 'countryCode', dataIndex: 'countryCode', width: 90 },
    { title: 'countryName', dataIndex: 'countryName' },
    { title: 'nativeName', dataIndex: 'nativeName', ellipsis: true },
    { title: 'steamCc', dataIndex: 'steamCc', width: 80 },
    { title: 'steamLanguage', dataIndex: 'steamLanguage', width: 110 },
    { title: 'currency', dataIndex: 'defaultCurrency', width: 90 },
    { title: 'symbol', dataIndex: 'currencySymbol', width: 90 },
    { title: 'sort', dataIndex: 'sortOrder', width: 70 },
    {
      title: 'enabled',
      dataIndex: 'enabled',
      width: 90,
      render: (en: boolean, r: Row) => (
        <Switch
          checked={en}
          onChange={async (checked) => {
            try {
              await adminApi.regionCountriesSetEnabled(r.countryCode, checked);
              message.success('已更新');
              await reload();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '更新失败');
            }
          }}
        />
      ),
    },
    {
      title: '',
      key: 'edit',
      width: 80,
      render: (_, r) => (
        <Button type="link" onClick={() => { setEditing(r); form.setFieldsValue(r); setOpen(true); }}>
          编辑
        </Button>
      ),
    },
  ];

  return (
    <Card title="Country / Steam Region Mapping">
      <Typography.Paragraph type="secondary">
        配置 App 国家与 Steam 商店 cc / 语言。公开接口仅返回 enabled 国家；详情页价格以 Steam 返回的 formatted 字符串为准。
      </Typography.Paragraph>
      <Space style={{ marginBottom: 12 }}>
        <Button
          type="primary"
          onClick={() => {
            setEditing(null);
            form.resetFields();
            form.setFieldsValue({
              enabled: true,
              sortOrder: 500,
              steamLanguage: 'en',
              defaultCurrency: 'USD',
              currencySymbol: '$',
            });
            setOpen(true);
          }}
        >
          新增国家
        </Button>
        <Button onClick={() => void reload()} loading={loading}>
          刷新
        </Button>
      </Space>
      <Table<Row> rowKey="countryCode" loading={loading} columns={columns} dataSource={rows} scroll={{ x: 960 }} />
      <Modal
        title={editing ? `编辑 ${editing.countryCode}` : '新增国家'}
        open={open}
        onOk={() => void onSubmit()}
        onCancel={() => setOpen(false)}
        destroyOnClose
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="countryCode" label="countryCode (ISO2)" rules={[{ required: true }]}>
            <Input disabled={!!editing} maxLength={2} />
          </Form.Item>
          <Form.Item name="countryName" label="countryName" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="nativeName" label="nativeName">
            <Input />
          </Form.Item>
          <Form.Item name="steamCc" label="steamCc" rules={[{ required: true }]}>
            <Input maxLength={2} />
          </Form.Item>
          <Form.Item name="steamLanguage" label="steamLanguage" rules={[{ required: true }]}>
            <Input placeholder="en, ja, zh, schinese…" />
          </Form.Item>
          <Form.Item name="defaultCurrency" label="defaultCurrency (fallback)" rules={[{ required: true }]}>
            <Input maxLength={3} />
          </Form.Item>
          <Form.Item name="currencySymbol" label="currencySymbol" rules={[{ required: true }]}>
            <Input maxLength={8} placeholder="$, €, ¥, R$..." />
          </Form.Item>
          <Form.Item name="sortOrder" label="sortOrder">
            <InputNumber min={0} max={99999} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="enabled" label="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
