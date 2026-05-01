import { Button, Card, Form, Input, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { adminApi } from '../api/admin';
import { setToken } from '../api/client';

export function LoginPage() {
  const nav = useNavigate();
  const [form] = Form.useForm();

  const onFinish = async (v: { username: string; password: string }) => {
    try {
      const out = await adminApi.login(v.username, v.password);
      setToken(out.token);
      message.success('登录成功');
      nav('/dashboard', { replace: true });
    } catch (e) {
      message.error(e instanceof Error ? e.message : '登录失败');
    }
  };

  return (
    <div style={{ maxWidth: 400, margin: '80px auto' }}>
      <Typography.Title level={3} style={{ textAlign: 'center' }}>
        视频管理后台
      </Typography.Title>
      <Card>
        <Form form={form} layout="vertical" onFinish={onFinish}>
          <Form.Item name="username" label="用户名" rules={[{ required: true }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
