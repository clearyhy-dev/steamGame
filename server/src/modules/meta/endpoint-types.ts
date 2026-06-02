/** 谁在「正常业务」里主要调用该 HTTP（定时 Worker 另见 Swagger info 说明）。 */
export type EndpointAudience =
  | 'app'
  | 'admin'
  | 'public'
  | 'browser_oauth'
  | 'ops'
  | 'mixed';

export type EndpointRow = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  authRequired: boolean;
  scope: 'app_backend' | 'app_public' | 'admin' | 'third_party';
  /** 调用方角色（Swagger 第二维度标签） */
  audience: EndpointAudience;
  name: string;
  usedBy?: string[];
  notes?: string;
  /** 客户端/后台在什么时机调用（启动、进入页面、用户操作等） */
  whenToCall?: string;
  /** 接口职责与返回数据的用途 */
  purpose?: string;
};
