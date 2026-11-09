/**
 * SQL Server drop-in for the subset of the Supabase JS client this app uses.
 *
 * The app's services were written against `supabase.from(table).select()...`.
 * Instead of rewriting ~60 call sites, this module offers the same chainable
 * API and sends each query, as a small JSON description (DbQuerySpec), to an
 * executor:
 *   - in the browser: `createHttpExecutor()` POSTs it to the Express server
 *     at /api/db/query, which runs it on SQL Server (server/sqlServerDb.ts)
 *   - on the server: the SQL Server executor is called directly
 *
 * Supported: select (columns, count), insert, upsert (onConflict), update,
 * delete, eq/neq/gt/gte/lt/lte/like/ilike/in/is, order, range, limit,
 * single, maybeSingle, and `.select()` after a write to return rows.
 *
 * Realtime (`channel().on('postgres_changes', ...)`) is emulated by polling
 * /api/db/versions, which reports a change counter per table.
 *
 * Like supabase-js, queries never throw: they resolve to { data, error, ... }.
 */

export type DbFilterOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'in'
  | 'is';

export interface DbFilter {
  column: string;
  op: DbFilterOp;
  value: unknown;
}

export interface DbQuerySpec {
  table: string;
  action: 'select' | 'insert' | 'upsert' | 'update' | 'delete';
  columns?: string;
  filters?: DbFilter[];
  order?: { column: string; ascending: boolean }[];
  range?: { from: number; to: number };
  limit?: number;
  count?: 'exact' | null;
  head?: boolean;
  rows?: Record<string, unknown>[];
  values?: Record<string, unknown>;
  onConflict?: string;
  returning?: boolean;
}

export interface DbError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

export interface DbResult<T = any> {
  data: T;
  error: DbError | null;
  count: number | null;
  status: number;
  statusText: string;
}

export interface DbExecutor {
  query(spec: DbQuerySpec): Promise<DbResult>;
  versions?(): Promise<Record<string, number> | null>;
}

function errorResult(message: string, status = 500, code?: string): DbResult {
  return {
    data: null,
    error: { message, code, details: null, hint: null },
    count: null,
    status,
    statusText: 'Error',
  };
}

class SqlServerQueryBuilder implements PromiseLike<DbResult> {
  private spec: DbQuerySpec;
  private resultMode: 'many' | 'single' | 'maybeSingle' = 'many';

  constructor(
    private readonly executor: DbExecutor,
    table: string
  ) {
    this.spec = { table, action: 'select', columns: '*', filters: [], order: [] };
  }

  // ---- actions -----------------------------------------------------------
  select(columns = '*', options?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }) {
    if (this.spec.action === 'select') {
      this.spec.columns = columns || '*';
      if (options?.count) this.spec.count = 'exact';
      if (options?.head) this.spec.head = true;
    } else {
      // .insert(...).select() / .upsert(...).select() / .update(...).select()
      this.spec.returning = true;
      this.spec.columns = columns || '*';
    }
    return this;
  }

  insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
    this.spec.action = 'insert';
    this.spec.rows = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(
    rows: Record<string, unknown> | Record<string, unknown>[],
    options?: { onConflict?: string; ignoreDuplicates?: boolean }
  ) {
    this.spec.action = 'upsert';
    this.spec.rows = Array.isArray(rows) ? rows : [rows];
    if (options?.onConflict) this.spec.onConflict = options.onConflict;
    return this;
  }

  update(values: Record<string, unknown>) {
    this.spec.action = 'update';
    this.spec.values = values;
    return this;
  }

  delete() {
    this.spec.action = 'delete';
    return this;
  }

  // ---- filters -----------------------------------------------------------
  private addFilter(column: string, op: DbFilterOp, value: unknown) {
    this.spec.filters!.push({ column, op, value });
    return this;
  }
  eq(column: string, value: unknown) { return this.addFilter(column, 'eq', value); }
  neq(column: string, value: unknown) { return this.addFilter(column, 'neq', value); }
  gt(column: string, value: unknown) { return this.addFilter(column, 'gt', value); }
  gte(column: string, value: unknown) { return this.addFilter(column, 'gte', value); }
  lt(column: string, value: unknown) { return this.addFilter(column, 'lt', value); }
  lte(column: string, value: unknown) { return this.addFilter(column, 'lte', value); }
  like(column: string, pattern: string) { return this.addFilter(column, 'like', pattern); }
  ilike(column: string, pattern: string) { return this.addFilter(column, 'ilike', pattern); }
  in(column: string, values: unknown[]) { return this.addFilter(column, 'in', values); }
  is(column: string, value: null | boolean) { return this.addFilter(column, 'is', value); }

  // ---- modifiers ---------------------------------------------------------
  order(column: string, options?: { ascending?: boolean }) {
    this.spec.order!.push({ column, ascending: options?.ascending ?? true });
    return this;
  }
  range(from: number, to: number) {
    this.spec.range = { from, to };
    return this;
  }
  limit(count: number) {
    this.spec.limit = count;
    return this;
  }
  single() {
    this.resultMode = 'single';
    return this;
  }
  maybeSingle() {
    this.resultMode = 'maybeSingle';
    return this;
  }

  // ---- execution ---------------------------------------------------------
  private async execute(): Promise<DbResult> {
    let result: DbResult;
    try {
      result = await this.executor.query(this.spec);
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err), 0);
    }
    if (result.error || this.resultMode === 'many') return result;

    const rows = Array.isArray(result.data) ? result.data : [];
    if (rows.length > 1) {
      return errorResult(
        'JSON object requested, multiple (or no) rows returned',
        406,
        'PGRST116'
      );
    }
    if (rows.length === 0) {
      if (this.resultMode === 'maybeSingle') return { ...result, data: null };
      return errorResult(
        'JSON object requested, multiple (or no) rows returned',
        406,
        'PGRST116'
      );
    }
    return { ...result, data: rows[0] };
  }

  then<R1 = DbResult, R2 = never>(
    onfulfilled?: ((value: DbResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null
  ): Promise<R1 | R2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

// ---- realtime emulation (polling) -------------------------------------------

type ChangeCallback = (payload: { table: string; eventType: '*' }) => void;

const POLL_INTERVAL_MS = 10_000;

class PollingChannel {
  private listeners: { table: string; callback: ChangeCallback }[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastVersions: Record<string, number> | null = null;

  constructor(private readonly executor: DbExecutor) {}

  on(
    _type: string,
    filter: { event?: string; schema?: string; table?: string },
    callback: ChangeCallback
  ) {
    if (filter?.table) this.listeners.push({ table: filter.table, callback });
    return this;
  }

  subscribe() {
    if (this.timer || !this.executor.versions) return this;
    const tick = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      const versions = await this.executor.versions!().catch(() => null);
      if (!versions) return;
      const previous = this.lastVersions;
      this.lastVersions = versions;
      if (!previous) return; // first poll sets the baseline
      const restarted = versions.__instance !== previous.__instance;
      for (const { table, callback } of this.listeners) {
        if (restarted || (versions[table] ?? 0) !== (previous[table] ?? 0)) {
          try {
            callback({ table, eventType: '*' });
          } catch {
            // listener errors must not stop polling
          }
        }
      }
    };
    void tick();
    this.timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return this;
  }

  unsubscribe() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    return Promise.resolve('ok');
  }
}

export interface SqlServerClient {
  from(table: string): SqlServerQueryBuilder;
  channel(name: string): PollingChannel;
  removeChannel(channel: PollingChannel): Promise<'ok'>;
  removeAllChannels(): Promise<'ok'[]>;
}

export function createSqlServerClient(executor: DbExecutor): SqlServerClient {
  const channels = new Set<PollingChannel>();
  return {
    from: (table: string) => new SqlServerQueryBuilder(executor, table),
    channel: () => {
      const ch = new PollingChannel(executor);
      channels.add(ch);
      return ch;
    },
    removeChannel: async (ch: PollingChannel) => {
      channels.delete(ch);
      await ch.unsubscribe();
      return 'ok';
    },
    removeAllChannels: async () => {
      const all = [...channels];
      channels.clear();
      return Promise.all(all.map(async (ch) => {
        await ch.unsubscribe();
        return 'ok' as const;
      }));
    },
  };
}

/** Browser executor: sends queries to the Express server. */
export function createHttpExecutor(baseUrl = '/api/db'): DbExecutor {
  return {
    async query(spec) {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(spec),
        });
      } catch (err) {
        return errorResult(
          `Cannot reach the app server (${err instanceof Error ? err.message : String(err)})`,
          0,
          'NETWORK'
        );
      }
      try {
        const body = (await res.json()) as Partial<DbResult>;
        return {
          data: body.data ?? null,
          error: body.error ?? (res.ok ? null : { message: `HTTP ${res.status}` }),
          count: body.count ?? null,
          status: body.status ?? res.status,
          statusText: body.statusText ?? res.statusText,
        };
      } catch {
        return errorResult(`Unexpected response from server (HTTP ${res.status})`, res.status);
      }
    },
    async versions() {
      try {
        const res = await fetch(`${baseUrl}/versions`, { cache: 'no-store' });
        if (!res.ok) return null;
        return (await res.json()) as Record<string, number>;
      } catch {
        return null;
      }
    },
  };
}
