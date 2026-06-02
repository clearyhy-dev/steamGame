import type { Env } from '../../config/env';
import { getEffectiveEnv } from '../../config/runtime-config';
import { listBackgroundJobs, listKnownEndpoints } from './endpoint-catalog';
import type { EndpointAudience } from './endpoint-types';

type OpenApiSpec = Record<string, any>;

function tagForScope(scope: string): string {
  switch (scope) {
    case 'app_backend':
      return '接口域 · App 需登录';
    case 'app_public':
      return '接口域 · 公开';
    case 'admin':
      return '接口域 · Admin';
    case 'third_party':
      return '外部 · 第三方公网';
    default:
      return 'Other';
  }
}

function tagForAudience(a: EndpointAudience): string {
  switch (a) {
    case 'app':
      return '调用方 · 移动端 App';
    case 'admin':
      return '调用方 · Admin 后台';
    case 'public':
      return '调用方 · 公开 HTTP（含浏览器）';
    case 'browser_oauth':
      return '调用方 · 浏览器 OAuth';
    case 'ops':
      return '调用方 · 运维/文档';
    case 'mixed':
      return '调用方 · App / Admin / 脚本';
    default:
      return '调用方 · 其它';
  }
}

function audienceDescription(a: EndpointAudience): string {
  switch (a) {
    case 'app':
      return '主要由 Flutter 移动端携带 App JWT 调用。';
    case 'admin':
      return '由 Admin SPA + Admin JWT 调用（运营/运维）。';
    case 'public':
      return '匿名或可选登录均可访问；浏览器与 App 共用，权限差异见业务逻辑。';
    case 'browser_oauth':
      return '系统浏览器 / WebView 在 Steam OpenID 流程中跳转，不经 App 原生 HTTP 客户端。';
    case 'ops':
      return '探针、Swagger/OpenAPI、健康检查；非业务流量。';
    case 'mixed':
      return 'App 为主；后台排障或脚本亦可调用（须相应 JWT）。';
    default:
      return '';
  }
}

function formatBackgroundJobsMarkdown(): string {
  const jobs = listBackgroundJobs();
  const lines = jobs.map(
    (j) =>
      `### ${j.name} (\`${j.id}\`)\n\n` + `- **触发**：${j.trigger}\n` + `- **作用**：${j.purpose}\n`,
  );
  return ['## 后台定时任务（进程内，无 REST 路径）', '', ...lines].join('\n');
}

function toPathTemplate(p: string): string {
  // OpenAPI uses `{param}` instead of `:param`
  return p.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
}

function splitPathAndQuery(p: string): { path: string; queryNote?: string } {
  const idx = p.indexOf('?');
  if (idx < 0) return { path: p };
  return { path: p.slice(0, idx), queryNote: p.slice(idx + 1) };
}

export async function buildOpenApiSpec(env: Env): Promise<OpenApiSpec> {
  const e = await getEffectiveEnv(env);
  const serverUrl = String(e.appBaseUrl ?? '').trim().replace(/\/+$/, '');

  const endpoints = listKnownEndpoints().filter((r) => !String(r.path).startsWith('http'));
  const paths: Record<string, any> = {};

  for (const r of endpoints) {
    const { path, queryNote } = splitPathAndQuery(r.path);
    const tmpl = toPathTemplate(path);
    const method = r.method.toLowerCase();
    paths[tmpl] = paths[tmpl] ?? {};

    const parameters: any[] = [];
    for (const m of tmpl.matchAll(/\{([A-Za-z0-9_]+)\}/g)) {
      parameters.push({
        name: m[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
      });
    }
    if (queryNote) {
      parameters.push({
        name: '_query',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: `Query hint: ${queryNote}`,
      });
    }

    const descriptionLines = [
      `**调用方角色**\n${audienceDescription(r.audience)}`,
      r.whenToCall ? `**何时调用**\n${r.whenToCall}` : null,
      r.purpose ? `**作用**\n${r.purpose}` : null,
      r.usedBy?.length ? `**客户端/模块**\n${r.usedBy.join('；')}` : null,
      r.notes ? `**备注**\n${r.notes}` : null,
      r.authRequired ? '**认证**：需要 `Authorization: Bearer <JWT>`' : '**认证**：无（公开接口）',
    ].filter(Boolean);

    paths[tmpl][method] = {
      tags: [tagForAudience(r.audience), tagForScope(r.scope)],
      summary: r.name,
      description: descriptionLines.length ? descriptionLines.join('\n\n') : r.name,
      parameters: parameters.length ? parameters : undefined,
      responses: {
        200: { description: 'OK' },
        400: { description: 'Bad Request' },
        401: { description: 'Unauthorized' },
        500: { description: 'Server Error' },
      },
      security: r.authRequired ? [{ bearerAuth: [] }] : undefined,
    };
  }

  const spec: OpenApiSpec = {
    openapi: '3.0.0',
    info: {
      title: 'SteamGame API',
      version: '1.0.0',
      description:
        '**认证**：`/api/admin/*`（除登录）使用 **Admin JWT**；其余需登录接口使用 **App 用户 JWT**。本文档的 `bearerAuth` 仅表示 Bearer 形态，请在 Swagger「Authorize」中按路径选择正确 Token。\n\n' +
        '由服务端路由表生成的契约说明。标签 **「调用方 · …」** 区分 App / Admin / 公开 / OAuth / 运维；**「接口域 · …」** 区分需登录、公开、Admin、第三方引用。\n\n' +
        '同一接口可能挂在 `/api/v1` 与 `/v1` 两处（等价镜像），文档中仅列常见路径并在备注说明。\n\n' +
        formatBackgroundJobsMarkdown() +
        '\n---\n\nSwagger UI 默认展开全部操作；描述过长时在操作面板内滚动查看。',
    },
    servers: serverUrl ? [{ url: serverUrl }] : [],
    tags: [
      { name: '调用方 · 移动端 App', description: 'Flutter 客户端为主，通常带 Firebase/Google 登录后的 App JWT。' },
      { name: '调用方 · Admin 后台', description: '浏览器中的 Admin SPA，使用 Admin JWT。' },
      { name: '调用方 · 公开 HTTP（含浏览器）', description: '无需登录或匿名可访问的接口；数据范围可能受限。' },
      { name: '调用方 · 浏览器 OAuth', description: 'Steam OpenID 浏览器跳转链路。' },
      { name: '调用方 · 运维/文档', description: '健康检查、Swagger、OpenAPI JSON 等。' },
      { name: '调用方 · App / Admin / 脚本', description: '典型为 App，也可由后台或调试脚本调用。' },
      { name: '接口域 · App 需登录', description: '需要 App 用户 JWT 的业务接口。' },
      { name: '接口域 · 公开', description: '不要求 App JWT；部分仍可能要求其它凭证。' },
      { name: '接口域 · Admin', description: '挂在 /api/admin 下的运营接口。' },
      { name: '外部 · 第三方公网', description: '非本服务实现；客户端可能直连的外部 API。' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
    paths,
  };

  return spec;
}

