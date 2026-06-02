import { Button, Card, Form, Input, InputNumber, Switch, Tabs, Typography, message } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../api/admin';
import type { DiscountProvidersSettings, RuntimeEffectiveSettings, RuntimeSettingsResponse } from '../types';
import { InfrastructureStorageTab } from './InfrastructureStorageTab';

export function SettingsPage() {
  const [discountForm] = Form.useForm<DiscountProvidersSettings>();
  const [runtimeForm] = Form.useForm<RuntimeEffectiveSettings>();
  const [runtime, setRuntime] = useState<RuntimeEffectiveSettings | null>(null);
  const [resolvedDocs, setResolvedDocs] = useState<{ appSwaggerUiUrl: string; appOpenApiJsonUrl: string }>({
    appSwaggerUiUrl: '',
    appOpenApiJsonUrl: '',
  });
  const [loading, setLoading] = useState(false);
  const runtimeBase = (runtime?.appBaseUrl ?? '').replace(/\/+$/, '');

  const applyRuntimeResponse = useCallback(
    (rt: RuntimeSettingsResponse) => {
      const merged = {
        ...rt.effective,
        ...(rt.stored as Partial<RuntimeEffectiveSettings>),
      } as RuntimeEffectiveSettings;
      runtimeForm.setFieldsValue(merged);
      setRuntime(merged);
      setResolvedDocs(rt.resolved);
    },
    [runtimeForm],
  );

  useEffect(() => {
    (async () => {
      try {
        const [disc, rt] = await Promise.all([
          adminApi.getDiscountProvidersSettings(),
          adminApi.getRuntimeSettings(),
        ]);
        discountForm.setFieldsValue(disc);
        applyRuntimeResponse(rt);
      } catch (e) {
        message.error(e instanceof Error ? e.message : '加载配置失败');
      }
    })();
  }, [applyRuntimeResponse, discountForm, runtimeForm]);

  return (
    <Card title="系统配置">
      <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
        运行时常用项保存在 Firestore（<Typography.Text code>system_config/runtime</Typography.Text>），服务端合并环境变量后约
        60 秒内存缓存，对普通 API 延迟影响可忽略。客户端可 GET <Typography.Text code>/api/config</Typography.Text>{' '}
        在启动时拉取一次深链与超时等安全字段，不增加日常请求耗时。
      </Typography.Paragraph>
      <Tabs
        items={[
          {
            key: 'runtime',
            label: '运行时 / App',
            children: (
              <Form
                form={runtimeForm}
                layout="vertical"
                onFinish={async (v) => {
                  setLoading(true);
                  try {
                    await adminApi.patchRuntimeSettings(v);
                    const rt = await adminApi.getRuntimeSettings();
                    applyRuntimeResponse(rt);
                    message.success('已保存（进程内配置约 1 分钟内刷新）');
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : '保存失败');
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                <Typography.Title level={5}>API 文档链接（Swagger / OpenAPI）</Typography.Title>
                <Typography.Paragraph type="secondary">
                  填写完整 URL 可指向反向代理、备用域名或内网排障入口；<Typography.Text strong>留空</Typography.Text>则使用{' '}
                  <Typography.Text code>APP_BASE_URL</Typography.Text> 拼接 <Typography.Text code>/api/docs</Typography.Text> 与{' '}
                  <Typography.Text code>/api/openapi.json</Typography.Text>。保存后客户端{' '}
                  <Typography.Text code>GET /api/config</Typography.Text> 会下发「当前生效」地址。
                </Typography.Paragraph>
                <Typography.Paragraph type="secondary">
                  当前生效（合并后）：
                  <br />
                  Swagger UI：<Typography.Text code copyable>{resolvedDocs.appSwaggerUiUrl || '—'}</Typography.Text>
                  <br />
                  OpenAPI JSON：<Typography.Text code copyable>{resolvedDocs.appOpenApiJsonUrl || '—'}</Typography.Text>
                </Typography.Paragraph>
                <Form.Item
                  label="Swagger UI URL（可选覆盖）"
                  name="appSwaggerUiUrl"
                  extra={runtimeBase ? `默认：${runtimeBase}/api/docs` : undefined}
                >
                  <Input placeholder={runtimeBase ? `${runtimeBase}/api/docs` : 'https://api.example.com/api/docs'} />
                </Form.Item>
                <Form.Item
                  label="OpenAPI JSON URL（可选覆盖）"
                  name="appOpenApiJsonUrl"
                  extra={runtimeBase ? `默认：${runtimeBase}/api/openapi.json` : undefined}
                >
                  <Input
                    placeholder={runtimeBase ? `${runtimeBase}/api/openapi.json` : 'https://api.example.com/api/openapi.json'}
                  />
                </Form.Item>

                <Typography.Title level={5}>管理员账号</Typography.Title>
                <Form.Item label="Admin 用户名" name="adminUsername">
                  <Input />
                </Form.Item>
                <Form.Item
                  label="Admin 密码"
                  name="adminPassword"
                  extra="留空表示不改密码；输入新值后保存即更新"
                >
                  <Input.Password placeholder="输入新密码（可选）" />
                </Form.Item>

                <Typography.Title level={5}>Steam 与深链</Typography.Title>
                <Form.Item
                  label="STEAM_API_KEY"
                  name="steamApiKey"
                  extra="可仅在此配置；留空并保存可清除覆盖项以回退到环境变量"
                >
                  <Input.Password placeholder="Steam Web API Key" />
                </Form.Item>
                <Form.Item label="Steam OpenID Realm" name="steamOpenidRealm">
                  <Input />
                </Form.Item>
                <Form.Item label="Steam 回调 URL (return_to 基础地址)" name="steamOpenidReturnUrl">
                  <Input placeholder="https://api.example.com/auth/steam/callback" />
                </Form.Item>
                <Form.Item label="APP_BASE_URL（公网根地址）" name="appBaseUrl">
                  <Input />
                </Form.Item>
                <Form.Item label="App 深链 scheme" name="appDeeplinkScheme" extra="须与 Android/iOS 已注册 scheme 一致">
                  <Input />
                </Form.Item>
                <Form.Item label="深链成功 host" name="appDeeplinkSuccessHost">
                  <Input />
                </Form.Item>
                <Form.Item label="深链失败 host" name="appDeeplinkFailHost">
                  <Input />
                </Form.Item>
                <Form.Item label="客户端连接超时 (秒)" name="appConnectTimeoutSec">
                  <InputNumber min={1} max={120} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="客户端读超时 (秒)" name="appReceiveTimeoutSec">
                  <InputNumber min={5} max={600} style={{ width: '100%' }} />
                </Form.Item>
                <Typography.Title level={5}>国家 / 货币 / Steam 语言</Typography.Title>
                <Typography.Paragraph type="secondary">
                  App 的 `GET /api/config` 中国家 CSV、语言→国家、国家→货币 **均由 Firestore「Country / Steam」表推导**，与{' '}
                  <Typography.Text code>/api/v1/config/countries</Typography.Text> 同源；请勿在此处重复配置。请到侧边栏{' '}
                  <Typography.Text strong>Country / Steam</Typography.Text>（<Typography.Text code>/country-region-mapping</Typography.Text>
                  ）维护启用国家、排序、货币与 uiLanguage。
                </Typography.Paragraph>

                <Typography.Title level={5}>Steam HTTP / 自动同步</Typography.Title>
                <Form.Item label="Steam HTTP 超时 (ms)" name="steamHttpTimeoutMs">
                  <InputNumber min={1000} max={120000} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="启用后台自动同步" name="steamAutoSyncEnabled" valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item label="同步间隔 (ms)" name="steamAutoSyncIntervalMs">
                  <InputNumber min={60000} max={86400000} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="每轮详情批量上限" name="steamAutoSyncBatchSize">
                  <InputNumber min={10} max={500} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="详情请求间隔 (ms)" name="steamAutoSyncDelayMs">
                  <InputNumber min={0} max={5000} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item
                  label="请求日志保留天数"
                  name="requestLogRetentionDays"
                  extra="用于自动清理 api_request_logs，推荐 7/14/30 天。"
                >
                  <InputNumber min={1} max={30} style={{ width: '100%' }} />
                </Form.Item>

                <Typography.Title level={5}>视频流水线</Typography.Title>
                <Typography.Paragraph type="secondary">
                  大文件存储（视频、缓存 JSON、折扣分桶）请在侧边栏 <Typography.Text strong>Settings → 数据存储 (Vultr)</Typography.Text>{' '}
                  查看 MinIO 地址与凭据；勿再配置 GCS 桶。
                </Typography.Paragraph>
                <Form.Item label="ffmpeg 路径" name="ffmpegPath">
                  <Input />
                </Form.Item>
                <Form.Item label="ffprobe 路径" name="ffprobePath">
                  <Input />
                </Form.Item>
                <Form.Item label="yt-dlp 路径" name="ytDlpPath">
                  <Input />
                </Form.Item>
                <Form.Item label="临时目录" name="videoTempDir">
                  <Input />
                </Form.Item>
                <Form.Item label="最大时长 (秒)" name="videoMaxDurationSec">
                  <InputNumber min={10} max={7200} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="截取时长 (秒)" name="videoTrimSec">
                  <InputNumber min={1} max={600} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="签名 URL 有效期 (分钟)" name="videoSignedUrlMinutes">
                  <InputNumber min={1} max={10080} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="视频任务 Worker 间隔 (ms)" name="videoWorkerIntervalMs">
                  <InputNumber min={1000} max={3600000} style={{ width: '100%' }} />
                </Form.Item>

                <Button type="primary" htmlType="submit" loading={loading}>
                  保存运行时配置
                </Button>
              </Form>
            ),
          },
          {
            key: 'infrastructure',
            label: '数据存储 (Vultr)',
            children: <InfrastructureStorageTab />,
          },
          {
            key: 'discount',
            label: '折扣渠道',
            children: (
              <Form
                form={discountForm}
                layout="vertical"
                onFinish={async (v) => {
                  try {
                    await adminApi.patchDiscountProvidersSettings(v);
                    message.success('配置已保存');
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : '保存失败');
                  }
                }}
              >
                <Form.Item label="ITAD API Key" name="itadApiKey">
                  <Input.Password placeholder="isthereanydeal key" />
                </Form.Item>
                <Form.Item label="GG.deals API Key" name="ggDealsApiKey">
                  <Input.Password placeholder="gg.deals key" />
                </Form.Item>
                <Form.Item label="Steam API Key" name="steamApiKey">
                  <Input.Password placeholder="Steam Web API key" />
                </Form.Item>
                <Form.Item label="ITAD Base URL" name="itadBaseUrl">
                  <Input />
                </Form.Item>
                <Form.Item label="GG.deals Base URL" name="ggDealsBaseUrl">
                  <Input />
                </Form.Item>
                <Form.Item label="CheapShark Base URL" name="cheapSharkBaseUrl">
                  <Input />
                </Form.Item>
                <Form.Item label="Steam Web API Base URL" name="steamWebApiBaseUrl">
                  <Input placeholder="https://api.steampowered.com" />
                </Form.Item>
                <Form.Item label="Steam Store Base URL" name="steamStoreBaseUrl">
                  <Input placeholder="https://store.steampowered.com" />
                </Form.Item>
                <Form.Item noStyle shouldUpdate={() => true}>
                  {() => (
                    <div style={{ marginBottom: 16, color: 'rgba(0,0,0,0.45)', fontSize: 12 }}>
                      折扣同步默认国家：后台「国家 / Steam」页中对公众启用的国家列表（可在该页维护，无需在此配置 CSV）。
                    </div>
                  )}
                </Form.Item>
                <Button type="primary" htmlType="submit">
                  保存折扣渠道
                </Button>
              </Form>
            ),
          },
        ]}
      />
    </Card>
  );
}
