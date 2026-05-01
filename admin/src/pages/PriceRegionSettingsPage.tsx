import { Button, Card, Form, Input, InputNumber, Select, Switch, Typography, message } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { adminApi } from '../api/admin';
import type { RegionSettings } from '../types';

const COUNTRY_OPTIONS = ['US', 'IN', 'JP', 'BR', 'PL', 'FR', 'DE', 'CN'] as const;
const SOURCE_OPTIONS = ['steam', 'itad', 'ggdeals', 'cheapshark'] as const;

function parseJsonMap(raw: string, fieldLabel: string): Record<string, string> {
  const text = raw.trim();
  if (!text) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${fieldLabel} 不是合法 JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldLabel} 必须是 JSON 对象`);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    out[String(k).trim().toUpperCase()] = String(v).trim();
  }
  return out;
}

function mapToPrettyJson(map?: Record<string, string>): string {
  if (!map || Object.keys(map).length === 0) return '';
  return JSON.stringify(map, null, 2);
}

export function PriceRegionSettingsPage() {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const countryOptions = useMemo(
    () => COUNTRY_OPTIONS.map((c) => ({ label: c, value: c })),
    [],
  );
  const sourceOptions = useMemo(
    () => SOURCE_OPTIONS.map((s) => ({ label: s, value: s })),
    [],
  );

  const reload = async () => {
    const data = await adminApi.getRegionSettings();
    form.setFieldsValue({
      ...data,
      countryCurrencyMapJson: mapToPrettyJson(data.countryCurrencyMap),
      countryLanguageMapJson: mapToPrettyJson(data.countryLanguageMap),
    });
  };

  useEffect(() => {
    (async () => {
      try {
        await reload();
      } catch (e) {
        message.error(e instanceof Error ? e.message : '加载 Price & Region Settings 失败');
      }
    })();
  }, [form]);

  const onSubmit = async (values: RegionSettings & { countryCurrencyMapJson?: string; countryLanguageMapJson?: string }) => {
    setLoading(true);
    try {
      const payload: Partial<RegionSettings> = {
        enabledCountries: (values.enabledCountries ?? []).map((c) => String(c).trim().toUpperCase()),
        defaultCountry: String(values.defaultCountry ?? '').trim().toUpperCase(),
        fallbackCountry: String(values.fallbackCountry ?? '').trim().toUpperCase(),
        countryCurrencyMap: parseJsonMap(values.countryCurrencyMapJson ?? '', 'countryCurrencyMap'),
        countryLanguageMap: parseJsonMap(values.countryLanguageMapJson ?? '', 'countryLanguageMap'),
        priceSources: (values.priceSources ?? []).map((s) => String(s).trim().toLowerCase()),
        cacheHours: Number(values.cacheHours ?? 6),
        showKeyshopDeals: !!values.showKeyshopDeals,
        showRegionWarning: !!values.showRegionWarning,
      };
      await adminApi.patchRegionSettings(payload);
      await reload();
      message.success('Price & Region Settings 已保存');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card title="Price & Region Settings">
      <Typography.Paragraph type="secondary">
        配置 Steam 区域价格系统基础参数（国家、货币、语言映射、来源和缓存）。第一阶段仅做基础架构，不改变现有业务展示逻辑。
      </Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={onSubmit}>
        <Form.Item label="enabledCountries" name="enabledCountries" rules={[{ required: true, message: '请选择至少一个国家' }]}>
          <Select mode="multiple" options={countryOptions} placeholder="选择可用价格区域" />
        </Form.Item>
        <Form.Item label="defaultCountry" name="defaultCountry" rules={[{ required: true, message: '请选择 defaultCountry' }]}>
          <Select options={countryOptions} />
        </Form.Item>
        <Form.Item label="fallbackCountry" name="fallbackCountry" rules={[{ required: true, message: '请选择 fallbackCountry' }]}>
          <Select options={countryOptions} />
        </Form.Item>
        <Form.Item
          label="countryCurrencyMap (JSON)"
          name="countryCurrencyMapJson"
          rules={[{ required: true, message: '请输入 countryCurrencyMap JSON' }]}
          extra='示例: {"US":"USD","JP":"JPY","CN":"CNY"}'
        >
          <Input.TextArea rows={6} />
        </Form.Item>
        <Form.Item
          label="countryLanguageMap (JSON)"
          name="countryLanguageMapJson"
          rules={[{ required: true, message: '请输入 countryLanguageMap JSON' }]}
          extra='示例: {"US":"en","JP":"ja","CN":"zh"}'
        >
          <Input.TextArea rows={6} />
        </Form.Item>
        <Form.Item label="priceSources" name="priceSources" rules={[{ required: true, message: '请选择 priceSources' }]}>
          <Select mode="multiple" options={sourceOptions} />
        </Form.Item>
        <Form.Item label="cacheHours" name="cacheHours" rules={[{ required: true, message: '请输入 cacheHours' }]}>
          <InputNumber min={1} max={168} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item label="showKeyshopDeals" name="showKeyshopDeals" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item label="showRegionWarning" name="showRegionWarning" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={loading}>
          保存 Price & Region Settings
        </Button>
      </Form>
    </Card>
  );
}

