import type { Env } from '../../config/env';
import { getEffectiveEnv } from '../../config/runtime-config';
import { listKnownEndpoints } from './meta.controller';

type OpenApiSpec = Record<string, any>;

function tagForScope(scope: string): string {
  switch (scope) {
    case 'app_backend':
      return 'App (auth)';
    case 'app_public':
      return 'App (public)';
    case 'admin':
      return 'Admin';
    case 'third_party':
      return '3rd party';
    default:
      return 'Other';
  }
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

    paths[tmpl][method] = {
      tags: [tagForScope(r.scope)],
      summary: r.name,
      description: [
        r.notes ? `Notes: ${r.notes}` : null,
        r.usedBy?.length ? `Used by: ${r.usedBy.join(', ')}` : null,
        r.authRequired ? 'Auth: Bearer token required' : 'Auth: none',
      ]
        .filter(Boolean)
        .join('\n'),
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
        'Auto-generated OpenAPI skeleton (for troubleshooting and manual testing). Tagged by usage scope: App vs Admin.',
    },
    servers: serverUrl ? [{ url: serverUrl }] : [],
    tags: [
      { name: 'App (public)' },
      { name: 'App (auth)' },
      { name: 'Admin' },
      { name: '3rd party' },
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

