import { Button, Card, Form, Input, InputNumber, Switch, Tabs, Typography, message } from 'antd';
import { useEffect, useState } from 'react';
import { adminApi } from '../api/admin';
import type { DiscountProvidersSettings, RuntimeEffectiveSettings } from '../types';

export function SettingsPage() {
  const [discountForm] = Form.useForm<DiscountProvidersSettings>();
  const [runtimeForm] = Form.useForm<RuntimeEffectiveSettings>();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [disc, rt] = await Promise.all([
          adminApi.getDiscountProvidersSettings(),
          adminApi.getRuntimeSettings(),
        ]);
        discountForm.setFieldsValue(disc);
        runtimeForm.setFieldsValue({
          ...rt.effective,
          ...(rt.stored as Partial<RuntimeEffectiveSettings>),
        });
      } catch (e) {
        message.error(e instanceof Error ? e.message : '加载配置失败');
      }
    })();
  }, [discountForm, runtimeForm]);

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
                    runtimeForm.setFieldsValue(rt.effective);
                    message.success('已保存（进程内配置约 1 分钟内刷新）');
                  } catch (e) {
                    message.error(e instanceof Error ? e.message : '保存失败');
                  } finally {
                    setLoading(false);
                  }
                }}
              >
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
                <Typography.Title level={5}>国家与货币映射（App 与后端统一）</Typography.Title>
                <Form.Item
                  label="支持的折扣国家 (CSV)"
                  name="appSupportedDealCountriesCsv"
                  extra="例如：US,CN,JP,KR,HK,SG,TW,GB,DE,FR,CA,AU,BR,RU"
                >
                  <Input placeholder="US,CN,JP,KR,HK,SG,TW,GB,DE,FR,CA,AU,BR,RU" />
                </Form.Item>
                <Form.Item
                  label="国家映射 JSON（App国家/语言 -> 后端国家）"
                  name="appCountryMapJson"
                  extra='示例：{"JP":"JP","JA":"JP","CN":"CN","ZH":"CN","EN":"US","DE":"DE","FR":"FR"}'
                >
                  <Input.TextArea rows={4} placeholder='{"EN":"US","JA":"JP","ZH":"CN"}' />
                </Form.Item>
                <Form.Item
                  label="国家-货币映射 JSON"
                  name="appCountryCurrencyMapJson"
                  extra='示例：{"US":"USD","JP":"JPY","CN":"CNY","GB":"GBP","DE":"EUR"}'
                >
                  <Input.TextArea rows={4} placeholder='{"US":"USD","JP":"JPY","CN":"CNY"}' />
                </Form.Item>

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

                <Typography.Title level={5}>视频流水线</Typography.Title>
                <Form.Item label="VIDEO_GCS_BUCKET" name="videoGcsBucket">
                  <Input placeholder="可选" />
                </Form.Item>
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
                <Form.Item label="ITAD Base URL" name="itadBaseUrl">
                  <Input />
                </Form.Item>
                <Form.Item label="GG.deals Base URL" name="ggDealsBaseUrl">
                  <Input />
                </Form.Item>
                <Form.Item label="CheapShark Base URL" name="cheapSharkBaseUrl">
                  <Input />
                </Form.Item>
                <Form.Item
                  label="折扣国家列表 (CSV)"
                  name="dealCountriesCsv"
                  extra="例如：US,CN,JP。折扣同步会按国家分别抓取并落库。"
                >
                  <Input placeholder="US,CN,JP" />
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
