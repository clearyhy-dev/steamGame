import admin from 'firebase-admin';
import type { Firestore } from 'firebase-admin/firestore';
import { VultrDbApiClient, type VultrQuerySpec } from './api-client';
import { serializeForSqlite } from './serialize';

export const DOCUMENT_ID_FIELD = '__name__';

class VultrDocumentSnapshot {
  constructor(
    readonly exists: boolean,
    readonly id: string,
    private readonly _data: Record<string, unknown> | undefined,
    readonly ref: VultrDocumentReference,
  ) {}

  data(): Record<string, unknown> | undefined {
    return this._data;
  }
}

class VultrDocumentReference {
  constructor(
    readonly id: string,
    readonly collectionId: string,
    private readonly client: VultrDbApiClient,
  ) {}

  async get(): Promise<VultrDocumentSnapshot> {
    const row = await this.client.getDoc(this.collectionId, this.id);
    return new VultrDocumentSnapshot(row.exists, this.id, row.data, this);
  }

  async set(data: Record<string, unknown>, opts?: { merge?: boolean }): Promise<void> {
    await this.client.setDoc(this.collectionId, this.id, data, opts?.merge === true);
  }

  async delete(): Promise<void> {
    await this.client.deleteDoc(this.collectionId, this.id);
  }
}

class VultrQuerySnapshot {
  constructor(
    readonly empty: boolean,
    readonly size: number,
    readonly docs: VultrQueryDocumentSnapshot[],
  ) {}
}

class VultrQueryDocumentSnapshot extends VultrDocumentSnapshot {
  constructor(
    exists: boolean,
    id: string,
    data: Record<string, unknown> | undefined,
    ref: VultrDocumentReference,
  ) {
    super(exists, id, data, ref);
  }
}

class VultrQuery {
  private filters: VultrQuerySpec['filters'] = [];
  private orderByClause?: VultrQuerySpec['orderBy'];
  private limitN?: number;
  private offsetN?: number;
  private startAfterSnap?: VultrQueryDocumentSnapshot;

  constructor(
    private readonly collectionId: string,
    private readonly client: VultrDbApiClient,
  ) {}

  where(field: string, op: '==' | 'in' | '!=' | '<' | '<=' | '>' | '>=', value: unknown): this {
    if (op === '<' || op === '<=' || op === '>' || op === '>=') {
      throw new Error(`Vultr SQLite store: unsupported where operator ${op}`);
    }
    this.filters.push({ field, op, value });
    return this;
  }

  orderBy(field: string | { toString(): string }, direction: 'asc' | 'desc' = 'asc'): this {
    const f = String(field);
    this.orderByClause = { field: f === DOCUMENT_ID_FIELD || f.includes('documentId') ? DOCUMENT_ID_FIELD : f, direction };
    return this;
  }

  limit(n: number): this {
    this.limitN = n;
    return this;
  }

  offset(n: number): this {
    this.offsetN = n;
    return this;
  }

  startAfter(doc: VultrQueryDocumentSnapshot): this {
    this.startAfterSnap = doc;
    return this;
  }

  private spec(): VultrQuerySpec {
    const spec: VultrQuerySpec = {
      collection: this.collectionId,
      filters: this.filters,
      limit: this.limitN,
      offset: this.offsetN,
      startAfterId: this.startAfterSnap?.id,
    };
    if (this.orderByClause) spec.orderBy = this.orderByClause;
    return spec;
  }

  async get(): Promise<VultrQuerySnapshot> {
    const rows = await this.client.query(this.spec());
    const docs = rows.map(
      (r) =>
        new VultrQueryDocumentSnapshot(
          true,
          r.id,
          r.data,
          new VultrDocumentReference(r.id, this.collectionId, this.client),
        ),
    );
    return new VultrQuerySnapshot(docs.length === 0, docs.length, docs);
  }

  count(): { get: () => Promise<{ data: () => { count: number } }> } {
    return {
      get: async () => {
        const n = await this.client.count(this.spec());
        return { data: () => ({ count: n }) };
      },
    };
  }
}

class VultrCollectionReference {
  constructor(
    readonly id: string,
    private readonly client: VultrDbApiClient,
  ) {}

  doc(docId?: string): VultrDocumentReference {
    const id = docId ?? crypto.randomUUID();
    return new VultrDocumentReference(id, this.id, this.client);
  }

  where(field: string, op: '==' | 'in' | '!=' | '<' | '<=' | '>' | '>=', value: unknown): VultrQuery {
    return new VultrQuery(this.id, this.client).where(field, op, value);
  }

  orderBy(field: string | { toString(): string }, direction: 'asc' | 'desc' = 'asc'): VultrQuery {
    return new VultrQuery(this.id, this.client).orderBy(field, direction);
  }

  limit(n: number): VultrQuery {
    return new VultrQuery(this.id, this.client).limit(n);
  }

  offset(n: number): VultrQuery {
    return new VultrQuery(this.id, this.client).offset(n);
  }

  /** Firestore CollectionReference 继承 Query，支持无过滤全表读取 */
  get(): Promise<VultrQuerySnapshot> {
    return new VultrQuery(this.id, this.client).get();
  }

  /** 与 Firestore CollectionReference.count() 一致 */
  count(): { get: () => Promise<{ data: () => { count: number } }> } {
    return new VultrQuery(this.id, this.client).count();
  }

  async add(data: Record<string, unknown>): Promise<VultrDocumentReference> {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
}

type BatchOp =
  | { type: 'set'; ref: VultrDocumentReference; data: Record<string, unknown>; merge: boolean }
  | { type: 'update'; ref: VultrDocumentReference; data: Record<string, unknown> }
  | { type: 'delete'; ref: VultrDocumentReference };

class VultrWriteBatch {
  private ops: BatchOp[] = [];

  set(ref: VultrDocumentReference, data: Record<string, unknown>, opts?: { merge?: boolean }): void {
    this.ops.push({ type: 'set', ref, data, merge: opts?.merge === true });
  }

  update(ref: VultrDocumentReference, data: Record<string, unknown>): void {
    this.ops.push({ type: 'update', ref, data });
  }

  delete(ref: VultrDocumentReference): void {
    this.ops.push({ type: 'delete', ref });
  }

  async commit(): Promise<void> {
    for (const op of this.ops) {
      if (op.type === 'delete') {
        await op.ref.delete();
        continue;
      }
      if (op.type === 'set') {
        await op.ref.set(op.data, { merge: op.merge });
        continue;
      }
      const cur = await op.ref.get();
      const merged = { ...(cur.data() ?? {}), ...op.data };
      await op.ref.set(merged, { merge: false });
    }
    this.ops = [];
  }
}

export class VultrCompatFirestore {
  readonly FieldPath = {
    documentId: () => DOCUMENT_ID_FIELD,
  };

  constructor(private readonly client: VultrDbApiClient) {}

  collection(name: string): VultrCollectionReference {
    return new VultrCollectionReference(name, this.client);
  }

  batch(): VultrWriteBatch {
    return new VultrWriteBatch();
  }

  async getAll(...refs: VultrDocumentReference[]): Promise<VultrDocumentSnapshot[]> {
    if (refs.length === 0) return [];
    const byCollection = new Map<string, string[]>();
    for (const r of refs) {
      const list = byCollection.get(r.collectionId) ?? [];
      list.push(r.id);
      byCollection.set(r.collectionId, list);
    }
    const out: VultrDocumentSnapshot[] = [];
    for (const [collection, ids] of byCollection.entries()) {
      const rows = await this.client.batchGet(collection, ids);
      const map = new Map(rows.map((r) => [r.id, r.data]));
      for (const id of ids) {
        const ref = new VultrDocumentReference(id, collection, this.client);
        const data = map.get(id);
        out.push(new VultrDocumentSnapshot(!!data, id, data, ref));
      }
    }
    return out;
  }
}

let _compat: VultrCompatFirestore | null = null;
let _client: VultrDbApiClient | null = null;

export function getVultrDbClient(): VultrDbApiClient {
  if (_client) return _client;
  const base = process.env.SQLITE_API_URL?.trim();
  if (!base) throw new Error('SQLITE_API_URL is required when DATA_STORE=vultr_sqlite');
  _client = new VultrDbApiClient(base, process.env.SQLITE_API_SECRET?.trim());
  return _client;
}

export function getVultrCompatFirestore(): VultrCompatFirestore {
  if (_compat) return _compat;
  _compat = new VultrCompatFirestore(getVultrDbClient());
  return _compat;
}

/** 供 getFirestore() 返回；运行时与 Firestore 共用 Timestamp */
export function asFirestore(db: VultrCompatFirestore): Firestore {
  return db as unknown as Firestore;
}

export { admin, serializeForSqlite };
