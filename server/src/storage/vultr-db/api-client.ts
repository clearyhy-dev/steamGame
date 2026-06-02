import { deserializeFromSqlite, serializeForSqlite } from './serialize';

export type VultrQuerySpec = {
  collection: string;
  filters: Array<{ field: string; op: '==' | 'in' | '!='; value: unknown }>;
  orderBy?: { field: string; direction?: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
  startAfterId?: string;
};

export class VultrDbApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret?: string,
  ) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.secret) h['X-Data-Api-Secret'] = this.secret;
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl.replace(/\/+$/, '')}${path}`;
    const res = await fetch(url, {
      method,
      headers: this.headers(),
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const json = (await res.json().catch(() => ({}))) as T & { message?: string; exists?: boolean };
    if (res.status === 404) {
      return json;
    }
    if (!res.ok) {
      throw new Error(`Vultr DB API ${method} ${path}: ${res.status} ${json.message ?? ''}`);
    }
    return json;
  }

  async getDoc(collection: string, docId: string): Promise<{ exists: boolean; id: string; data?: Record<string, unknown> }> {
    try {
      const out = await this.request<{
        ok: boolean;
        exists: boolean;
        id: string;
        data?: Record<string, unknown>;
      }>('GET', `/v1/doc/${encodeURIComponent(collection)}/${encodeURIComponent(docId)}`);
      if (!out.exists || !out.data) return { exists: false, id: docId };
      return {
        exists: true,
        id: docId,
        data: deserializeFromSqlite(out.data) as Record<string, unknown>,
      };
    } catch (e) {
      if (e instanceof Error && e.message.includes('404')) {
        return { exists: false, id: docId };
      }
      throw e;
    }
  }

  async setDoc(
    collection: string,
    docId: string,
    data: Record<string, unknown>,
    merge: boolean,
  ): Promise<void> {
    const payload = serializeForSqlite(data) as Record<string, unknown>;
    await this.request('PUT', `/v1/doc/${encodeURIComponent(collection)}/${encodeURIComponent(docId)}?merge=${merge ? '1' : '0'}`, {
      data: payload,
    });
  }

  async deleteDoc(collection: string, docId: string): Promise<void> {
    await this.request('DELETE', `/v1/doc/${encodeURIComponent(collection)}/${encodeURIComponent(docId)}`);
  }

  async query(spec: VultrQuerySpec): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
    const filters = spec.filters.map((f) => ({
      ...f,
      value: serializeForSqlite(f.value),
    }));
    const out = await this.request<{ ok: boolean; docs: Array<{ id: string; data: Record<string, unknown> }> }>(
      'POST',
      '/v1/query',
      { ...spec, filters },
    );
    return out.docs.map((d) => ({
      id: d.id,
      data: deserializeFromSqlite(d.data) as Record<string, unknown>,
    }));
  }

  async count(spec: VultrQuerySpec): Promise<number> {
    const filters = spec.filters.map((f) => ({
      ...f,
      value: serializeForSqlite(f.value),
    }));
    const out = await this.request<{ ok: boolean; count: number }>('POST', '/v1/count', {
      ...spec,
      filters,
    });
    return out.count;
  }

  async batchGet(collection: string, ids: string[]): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
    if (ids.length === 0) return [];
    const out = await this.request<{ ok: boolean; docs: Array<{ id: string; data: Record<string, unknown> }> }>(
      'POST',
      '/v1/batch-get',
      { collection, ids },
    );
    return out.docs.map((d) => ({
      id: d.id,
      data: deserializeFromSqlite(d.data) as Record<string, unknown>,
    }));
  }
}
