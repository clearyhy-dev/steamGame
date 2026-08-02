import { AutoComplete, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../api/admin';
import { defaultCurrencySymbol, effectiveCurrencySymbol } from '../utils/currencySymbol';

type Row = {
  countryCode: string;
  countryName: string;
  nativeName?: string;
  steamCc: string;
  /** ITAD API country（ISO2）；空则同 countryCode */
  itadCountry?: string;
  /** GG.deals region（通常小写 ISO2）；空则同 countryCode */
  ggDealsRegion?: string;
  /** CheapShark country 参数（ISO2）；空则同 countryCode */
  cheapsharkCountry?: string;
  steamLanguage: string;
  uiLanguage: string;
  defaultCurrency: string;
  currencySymbol: string;
  enabled: boolean;
  sortOrder: number;
  syncTier?: 'T1' | 'T2';
};

type SyncTierSettings = {
  t1TopNPerCountry: number;
  t2TopNPerCountry: number;
  t2SyncIntervalDays: number;
};

type ProviderMeta = {
  ggDealsSuggestedRegions: string[];
  cheapsharkListCountry: string;
  cheapsharkNote: string;
};

export function CountryRegionMappingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [form] = Form.useForm();
  const [providerMeta, setProviderMeta] = useState<ProviderMeta | null>(null);
  const [tierSettings, setTierSettings] = useState<SyncTierSettings | null>(null);
  const [tierStats, setTierStats] = useState<{ todaySyncCountries: number; t1Count: number; t2Count: number } | null>(
    null,
  );
  const [tierForm] = Form.useForm<SyncTierSettings>();
  const [tierSaving, setTierSaving] = useState(false);

  const loadTierSettings = useCallback(async () => {
    try {
      const r = await adminApi.regionCountriesGetSyncTierSettings();
      setTierSettings(r.settings);
      setTierStats({
        todaySyncCountries: r.todaySyncCountries,
        t1Count: r.t1Count,
        t2Count: r.t2Count,
      });
      tierForm.setFieldsValue(r.settings);
    } catch {
      setTierSettings(null);
      setTierStats(null);
    }
  }, [tierForm]);

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

  const loadProviderMeta = useCallback(async () => {
    try {
      const m = await adminApi.regionCountriesProviderMeta();
      setProviderMeta(m);
    } catch {
      setProviderMeta(null);
    }
  }, []);

  /** 首次进入：拉元数据；空白 ITAD/GG/CS 按规则写入库后再拉列表（幂等） */
  useEffect(() => {
    let cancelled = false;
    void loadProviderMeta();
    (async () => {
      try {
        const r = await adminApi.regionCountriesSyncProviderCodes(false);
        if (!cancelled && r.updated > 0) {
          message.success(`已按规则补全 ${r.updated} 条比价国别（GG 含 eu；CS 固定 US）`);
        }
      } catch {
        /* 同步失败仍加载表格 */
      }
      if (!cancelled) await reload();
      if (!cancelled) await loadTierSettings();
    })();
    return () => {
      cancelled = true;
    };
  }, [reload, loadProviderMeta, loadTierSettings]);

  const onSubmit = async () => {
    try {
      const v = await form.validateFields();
      const csFixed = providerMeta?.cheapsharkListCountry ?? 'US';
      await adminApi.regionCountriesUpsert({
        countryCode: String(v.countryCode).trim().toUpperCase(),
        countryName: String(v.countryName).trim(),
        nativeName: v.nativeName != null ? String(v.nativeName) : '',
        steamCc: String(v.steamCc).trim().toUpperCase(),
        itadCountry: String(v.itadCountry ?? '').trim(),
        ggDealsRegion: String(v.ggDealsRegion ?? '').trim(),
        cheapsharkCountry: csFixed,
        steamLanguage: String(v.steamLanguage).trim().toLowerCase(),
        uiLanguage: String(v.uiLanguage ?? '').trim().toLowerCase(),
        defaultCurrency: String(v.defaultCurrency).trim().toUpperCase(),
        currencySymbol: String(v.currencySymbol ?? '').trim(),
        enabled: !!v.enabled,
        sortOrder: Number(v.sortOrder ?? 500),
        syncTier: v.syncTier === 'T1' ? 'T1' : 'T2',
      });
      message.success('已保存');
      setOpen(false);
      await reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败');
    }
  };

  /** 与 App supportedLocales 一致：下拉只能选这些 */
  const APP_UI_LANG_OPTIONS = [
    { value: 'en', label: 'en · English' },
    { value: 'zh', label: 'zh · 中文' },
    { value: 'ja', label: 'ja · 日本語' },
    { value: 'ko', label: 'ko · 한국어' },
    { value: 'fr', label: 'fr · Français' },
    { value: 'de', label: 'de · Deutsch' },
    { value: 'es', label: 'es · Español' },
    { value: 'pt', label: 'pt · Português' },
    { value: 'ru', label: 'ru · Русский' },
    { value: 'pl', label: 'pl · Polski' },
    { value: 'it', label: 'it · Italiano' },
    { value: 'tr', label: 'tr · Türkçe' },
    { value: 'vi', label: 'vi · Tiếng Việt' },
    { value: 'th', label: 'th · ไทย' },
    { value: 'id', label: 'id · Indonesia' },
    { value: 'hi', label: 'hi · हिन्दी' },
    { value: 'ur', label: 'ur · اردو' },
    { value: 'ar', label: 'ar · العربية' },
    { value: 'he', label: 'he · עברית' },
    { value: 'el', label: 'el · Ελληνικά' },
    { value: 'nl', label: 'nl · Nederlands' },
    { value: 'sv', label: 'sv · Svenska' },
  ];
  const APP_UI_LANG_SET = new Set(APP_UI_LANG_OPTIONS.map((x) => x.value));

  /** 空值建议默认；不会把已设的合法 App 语言（含 en）按国家强改 */
  const UI_LANG_BY_COUNTRY: Record<string, string> = {
    US: 'en', GB: 'en', AU: 'en', NZ: 'en', IE: 'en', CA: 'en',
    CN: 'zh', TW: 'zh', HK: 'zh', SG: 'zh',
    JP: 'ja', KR: 'ko', FR: 'fr', BE: 'fr',
    DE: 'de', AT: 'de', CH: 'de',
    BR: 'pt', PT: 'pt', PL: 'pl',
    ES: 'es', MX: 'es', AR: 'es', CL: 'es', CO: 'es', PE: 'es',
    IT: 'it', RU: 'ru', UA: 'ru', TR: 'tr',
    VN: 'vi', TH: 'th', ID: 'id', IN: 'hi', PK: 'ur',
    SA: 'ar', AE: 'ar', EG: 'ar', IL: 'he', GR: 'el', NL: 'nl', SE: 'sv',
  };

  const clampAppUiLang = (code?: string) => {
    const cur = String(code || '').trim().toLowerCase().split(/[-_]/)[0] || '';
    if (cur && APP_UI_LANG_SET.has(cur)) return cur;
    return '';
  };

  /**
   * 与后端 inferUiLanguage 一致：
   * - FR/JP/DE 等有 App 专属语言：空或历史 en → 用专属语言
   * - US 等英文区 / 无映射：保留已存合法值，否则 en
   */
  const preferredUiLang = (countryCode: string, current?: string) => {
    const cc = String(countryCode || '').trim().toUpperCase();
    const mapped = UI_LANG_BY_COUNTRY[cc];
    const mappedOk = mapped && APP_UI_LANG_SET.has(mapped) ? mapped : '';
    const kept = clampAppUiLang(current);
    if (mappedOk && mappedOk !== 'en') {
      if (!kept || kept === 'en') return mappedOk;
      return kept;
    }
    if (kept) return kept;
    return mappedOk || 'en';
  };

  const columns: ColumnsType<Row> = [
    { title: 'countryCode', dataIndex: 'countryCode', width: 90 },
    { title: 'countryName', dataIndex: 'countryName' },
    { title: 'nativeName', dataIndex: 'nativeName', ellipsis: true },
    { title: 'steamCc', dataIndex: 'steamCc', width: 80 },
    { title: 'ITAD', dataIndex: 'itadCountry', width: 72, render: (v: string) => v || '—' },
    { title: 'GG', dataIndex: 'ggDealsRegion', width: 72, render: (v: string) => v || '—' },
    { title: 'CS', dataIndex: 'cheapsharkCountry', width: 72, render: (v: string) => v || '—' },
    { title: 'steamLanguage', dataIndex: 'steamLanguage', width: 110 },
    {
      title: 'uiLanguage',
      dataIndex: 'uiLanguage',
      width: 120,
      render: (v: string, r: Row) => preferredUiLang(r.countryCode, v),
    },
    { title: 'currency', dataIndex: 'defaultCurrency', width: 90 },
    {
      title: 'symbol',
      dataIndex: 'currencySymbol',
      width: 90,
      render: (v: string, r: Row) => effectiveCurrencySymbol(r.defaultCurrency, v),
    },
    { title: 'sort', dataIndex: 'sortOrder', width: 70 },
    {
      title: '同步层级',
      dataIndex: 'syncTier',
      width: 110,
      render: (tier: 'T1' | 'T2' | undefined, r: Row) => (
        <Select
          size="small"
          style={{ width: 88 }}
          value={tier === 'T1' ? 'T1' : 'T2'}
          options={[
            { value: 'T1', label: 'T1' },
            { value: 'T2', label: 'T2' },
          ]}
          onChange={async (v: 'T1' | 'T2') => {
            try {
              await adminApi.regionCountriesSetSyncTier(r.countryCode, v);
              message.success(`${r.countryCode} → ${v}`);
              await reload();
              await loadTierSettings();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '更新失败');
            }
          }}
        />
      ),
    },
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
        <Button
          type="link"
          onClick={() => {
            setEditing(r);
            form.setFieldsValue({
              ...r,
              uiLanguage: preferredUiLang(r.countryCode, r.uiLanguage),
              cheapsharkCountry: providerMeta?.cheapsharkListCountry ?? 'US',
            });
            setOpen(true);
          }}
        >
          编辑
        </Button>
      ),
    },
  ];

  return (
    <Card title="Country / Steam · 比价平台国别">
      <Card size="small" title="分层折扣同步（T1 / T2）" style={{ marginBottom: 16 }}>
        <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
          <Typography.Text strong>T1</Typography.Text>：每天同步，Top N 较大（默认 500）。
          <Typography.Text strong> T2</Typography.Text>：每 N 天同步一次，Top N 较小（默认 200）。
          下方表格可逐国调整层级；保存后立即作用于分片同步任务。
          {tierStats ? (
            <>
              {' '}
              今日待同步：<Typography.Text code>{tierStats.todaySyncCountries}</Typography.Text> 国（T1{' '}
              {tierStats.t1Count} · T2 {tierStats.t2Count}）。
            </>
          ) : null}
        </Typography.Paragraph>
        <Form
          form={tierForm}
          layout="inline"
          onFinish={async (v) => {
            setTierSaving(true);
            try {
              await adminApi.regionCountriesSaveSyncTierSettings(v);
              message.success('分层参数已保存');
              await loadTierSettings();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '保存失败');
            } finally {
              setTierSaving(false);
            }
          }}
        >
          <Form.Item name="t1TopNPerCountry" label="T1 TopN">
            <InputNumber min={1} max={500} />
          </Form.Item>
          <Form.Item name="t2TopNPerCountry" label="T2 TopN">
            <InputNumber min={1} max={500} />
          </Form.Item>
          <Form.Item name="t2SyncIntervalDays" label="T2 间隔(天)">
            <InputNumber min={1} max={14} />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={tierSaving}>
                保存分层参数
              </Button>
              <Button
                onClick={async () => {
                  try {
                    const r = await adminApi.regionCountriesResetSyncTiersDefault(false);
                    message.success(r.updated ? `已初始化 ${r.updated} 国默认层级` : '层级已是最新默认');
                    await reload();
                    await loadTierSettings();
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : '重置失败');
                  }
                }}
              >
                恢复默认 T1 列表
              </Button>
            </Space>
          </Form.Item>
        </Form>
        {tierSettings ? (
          <Typography.Text type="secondary">
            当前：T1 Top{tierSettings.t1TopNPerCountry} · T2 Top{tierSettings.t2TopNPerCountry} · T2 每
            {tierSettings.t2SyncIntervalDays} 天
          </Typography.Text>
        ) : null}
      </Card>
      <Typography.Paragraph type="secondary">
        <Typography.Text strong>ITAD</Typography.Text>：<Typography.Text code>country</Typography.Text> 用与 Steam 店区一致的 ISO2 大写。
        <Typography.Text strong> GG.deals</Typography.Text>：<Typography.Text code>region</Typography.Text> 用小写；欧元区部分国家用{' '}
        <Typography.Text code>eu</Typography.Text>（奥地利、葡萄牙、希腊等无单独 region 时）。
        <Typography.Text strong> CheapShark</Typography.Text>：列表 API 无真实区域价，
        <Typography.Text code>country</Typography.Text> 请固定 <Typography.Text code>US</Typography.Text>，各国折扣以 ITAD/GG 为准。
      </Typography.Paragraph>
      <Space style={{ marginBottom: 12 }} wrap>
        <Button
          onClick={async () => {
            try {
              const r = await adminApi.regionCountriesSyncProviderCodes(false);
              message.success(r.updated ? `已补全空白 ${r.updated} 条（含 GG eu / CS US）` : '无空白需补全');
              await reload();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '同步失败');
            }
          }}
        >
          按规则补全空白
        </Button>
        <Button
          danger
          onClick={async () => {
            try {
              const r = await adminApi.regionCountriesSyncProviderCodes(true);
              message.success(`已强制覆盖 ${r.updated} 条（ITAD/GG/CS 规则）`);
              await reload();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '同步失败');
            }
          }}
        >
          强制按规则覆盖全部
        </Button>
        <Button
          onClick={async () => {
            try {
              let n = 0;
              for (const r of rows) {
                const next = preferredUiLang(r.countryCode, r.uiLanguage);
                if (next === String(r.uiLanguage || '').trim().toLowerCase()) continue;
                await adminApi.regionCountriesUpsert({
                  ...r,
                  uiLanguage: next,
                  cheapsharkCountry: providerMeta?.cheapsharkListCountry ?? r.cheapsharkCountry ?? 'US',
                });
                n += 1;
              }
              message.success(n > 0 ? `已写回 App 对应语言：${n} 条（如 FR→fr）` : '已与 App 语言对齐，无需更新');
              await reload();
            } catch (e) {
              message.error(e instanceof Error ? e.message : '匹配失败');
            }
          }}
        >
          写回 App 对应 uiLanguage
        </Button>
        <Button
          type="primary"
          onClick={() => {
            setEditing(null);
            form.resetFields();
            form.setFieldsValue({
              enabled: true,
              sortOrder: 500,
              steamLanguage: 'en',
              uiLanguage: 'en',
              defaultCurrency: 'USD',
              currencySymbol: '$',
              cheapsharkCountry: providerMeta?.cheapsharkListCountry ?? 'US',
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
      <Table<Row> rowKey="countryCode" loading={loading} columns={columns} dataSource={rows} scroll={{ x: 1200 }} />
      <Modal
        title={editing ? `编辑 ${editing.countryCode}` : '新增国家'}
        open={open}
        onOk={() => void onSubmit()}
        onCancel={() => setOpen(false)}
        destroyOnClose
        width={640}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="countryCode" label="countryCode (ISO2)" rules={[{ required: true }]}>
            <Input
              disabled={!!editing}
              maxLength={2}
              onChange={(e) => {
                const code = e.target.value.trim().toUpperCase();
                if (/^[A-Z]{2}$/.test(code)) {
                  form.setFieldValue('uiLanguage', preferredUiLang(code));
                  if (!form.getFieldValue('steamCc')) {
                    form.setFieldValue('steamCc', code);
                  }
                }
              }}
            />
          </Form.Item>
          <Form.Item name="countryName" label="countryName" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="nativeName" label="nativeName">
            <Input />
          </Form.Item>
          <Form.Item name="steamCc" label="steamCc (Steam 商店)" rules={[{ required: true }]}>
            <Input maxLength={2} />
          </Form.Item>
          <Typography.Text type="secondary">
            以下为各比价平台；留空时保存会按 Steam cc 自动填 ITAD/GG，CheapShark 固定 US。
          </Typography.Text>
          <Form.Item
            name="itadCountry"
            label="ITAD country (ISO2)"
            extra="与 Steam 店区一致的大写 ISO2；留空则按 steamCc"
          >
            <Input maxLength={2} placeholder="留空 = 按 steamCc" />
          </Form.Item>
          <Form.Item
            name="ggDealsRegion"
            label="GG.deals region"
            extra="小写两位（或 eu）。官方仅支持文档列表中的 region；jp/kr/cn 等非官方码会在同步时显式代理到 us/br/eu（币种为代理区货币）"
          >
            <AutoComplete
              maxLength={8}
              placeholder="如 de、gb、eu…"
              options={(providerMeta?.ggDealsSuggestedRegions ?? []).map((x) => ({ value: x }))}
              filterOption={(input, option) =>
                (option?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item name="cheapsharkCountry" hidden>
            <Input />
          </Form.Item>
          <Form.Item label="CheapShark country">
            <Typography.Text>
              固定 <Typography.Text code>{providerMeta?.cheapsharkListCountry ?? 'US'}</Typography.Text>
            </Typography.Text>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0, marginTop: 4 }}>
              {providerMeta?.cheapsharkNote ??
                'CheapShark 无按国别区分的 deal 列表；保存时写入 US。'}
            </Typography.Paragraph>
          </Form.Item>
          <Form.Item name="steamLanguage" label="steamLanguage" rules={[{ required: true }]}>
            <Input placeholder="en, japanese, schinese…" />
          </Form.Item>
          <Form.Item
            name="uiLanguage"
            label="uiLanguage（App 界面语言）"
            rules={[{ required: true }]}
            extra="只能选 App 已有多语言。FR/JP/DE 等有本国语言时会从历史 en 纠正为对应语言；无映射国保持 en"
          >
            <Select showSearch options={APP_UI_LANG_OPTIONS} optionFilterProp="label" />
          </Form.Item>
          <Form.Item name="defaultCurrency" label="defaultCurrency (fallback)" rules={[{ required: true }]}>
            <Input
              maxLength={3}
              onChange={(e) => {
                const code = e.target.value.trim().toUpperCase();
                if (/^[A-Z]{3}$/.test(code)) {
                  form.setFieldValue('currencySymbol', defaultCurrencySymbol(code));
                }
              }}
            />
          </Form.Item>
          <Form.Item name="currencySymbol" label="currencySymbol" rules={[{ required: true }]}>
            <Input maxLength={8} placeholder="$, €, ¥, R$..." />
          </Form.Item>
          <Form.Item name="sortOrder" label="sortOrder">
            <InputNumber min={0} max={99999} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="syncTier" label="同步层级 (T1/T2)" initialValue="T2">
            <Select
              options={[
                { value: 'T1', label: 'T1 · 每天 · 大 TopN' },
                { value: 'T2', label: 'T2 · 间隔同步 · 小 TopN' },
              ]}
            />
          </Form.Item>
          <Form.Item name="enabled" label="enabled" valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  );
}
