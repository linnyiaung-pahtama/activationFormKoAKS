/**
 * Runs DbQuerySpec queries (see src/lib/sqlServerClient.ts) against SQL Server.
 *
 * Safety:
 *  - only the tables in ALLOWED_TABLES can be touched
 *  - every table/column name is checked against the live schema (sys.columns)
 *    and written as [bracketed] identifiers; nothing from the request is
 *    pasted into SQL text
 *  - every value is sent as a parameter (or inside one JSON parameter for
 *    bulk inserts/upserts, read with OPENJSON)
 *  - UPDATE and DELETE without a filter are refused
 *
 * Connection settings come from environment variables (see .env.example):
 *  MSSQL_CONNECTION_STRING   full ODBC connection string (Windows auth, LocalDB)
 *                            -> uses the msnodesqlv8 driver
 *  or MSSQL_SERVER / MSSQL_DATABASE / MSSQL_USER / MSSQL_PASSWORD / MSSQL_PORT
 *     MSSQL_ENCRYPT / MSSQL_TRUST_SERVER_CERTIFICATE
 *                            -> SQL login over TCP with the tedious driver
 */
import type { DbError, DbExecutor, DbFilter, DbQuerySpec, DbResult } from '../src/lib/sqlServerClient.ts';

export const ALLOWED_TABLES = [
  'app_users',
  'noodle_activations',
  'noodle_activation_sku_details',
  'wholesale_stores',
  'product_master_skus',
  'user_locations',
] as const;

/** Columns stored as JSON text; returned to the app as objects/arrays. */
const JSON_COLUMNS: Record<string, string[]> = {
  noodle_activations: ['items'],
  user_locations: ['payload'],
};

/** Natural keys that ON CONFLICT targets may use besides the primary key. */
const ALLOWED_CONFLICT_TARGETS: Record<string, string[][]> = {
  app_users: [['id'], ['username']],
  wholesale_stores: [['id'], ['name']],
  product_master_skus: [['id'], ['code']],
};

interface ColumnInfo {
  name: string;
  type: string; // sql type name: nvarchar, int, bit, ...
  sqlType: string; // full declaration for OPENJSON WITH: NVARCHAR(200), DECIMAL(12,2) ...
  nullable: boolean;
  isJson: boolean;
}

interface TableInfo {
  name: string;
  columns: Map<string, ColumnInfo>;
  columnOrder: string[];
  primaryKey: string[];
  hasTriggers: boolean;
}

type MssqlModule = typeof import('mssql');
type Pool = import('mssql').ConnectionPool;

let mssql: MssqlModule | null = null;
let poolPromise: Promise<Pool> | null = null;
let schemaPromise: Promise<Map<string, TableInfo>> | null = null;

const instanceId = Date.now();
const tableVersions: Record<string, number> = {};

export function isSqlServerBackend(): boolean {
  return String(process.env.DATA_BACKEND || '').toLowerCase() === 'sqlserver';
}

async function getPool(): Promise<Pool> {
  if (!poolPromise) {
    poolPromise = (async () => {
      // An unhandled pool 'error' event would crash the whole app server
      // (e.g. when LocalDB shuts down while idle). Log it and reconnect next time.
      const watch = (pool: Pool): Pool => {
        pool.on('error', (err: Error) => {
          console.error('[sqlserver] connection pool error:', err?.message || err);
          poolPromise = null;
        });
        return pool;
      };
      const connectionString = process.env.MSSQL_CONNECTION_STRING?.trim();
      if (connectionString) {
        const mod = (await import('mssql/msnodesqlv8.js')) as any;
        mssql = (mod.default ?? mod) as MssqlModule;
        return watch(await new mssql.ConnectionPool({ connectionString } as any).connect());
      }
      const mod = (await import('mssql')) as any;
      mssql = (mod.default ?? mod) as MssqlModule;
      return watch(await new mssql.ConnectionPool({
        server: process.env.MSSQL_SERVER || 'localhost',
        port: process.env.MSSQL_PORT ? Number(process.env.MSSQL_PORT) : undefined,
        database: process.env.MSSQL_DATABASE || 'PLS',
        user: process.env.MSSQL_USER,
        password: process.env.MSSQL_PASSWORD,
        options: {
          encrypt: String(process.env.MSSQL_ENCRYPT ?? 'true') !== 'false',
          trustServerCertificate:
            String(process.env.MSSQL_TRUST_SERVER_CERTIFICATE ?? 'false') === 'true',
        },
        pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
      }).connect());
    })().catch((err) => {
      poolPromise = null; // retry on next request
      throw err;
    });
  }
  return poolPromise;
}

async function getSchema(): Promise<Map<string, TableInfo>> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      const pool = await getPool();
      const tableList = ALLOWED_TABLES.map((t) => `'${t}'`).join(',');
      const cols = await pool.request().query(`
        SELECT t.name AS table_name, c.name AS column_name, ty.name AS type_name,
               c.max_length, c.precision, c.scale, c.is_nullable, c.column_id
        FROM sys.tables t
        JOIN sys.columns c ON c.object_id = t.object_id
        JOIN sys.types ty ON ty.user_type_id = c.user_type_id
        WHERE t.schema_id = SCHEMA_ID('dbo') AND t.name IN (${tableList})
        ORDER BY t.name, c.column_id`);
      const pks = await pool.request().query(`
        SELECT t.name AS table_name, c.name AS column_name
        FROM sys.tables t
        JOIN sys.indexes i ON i.object_id = t.object_id AND i.is_primary_key = 1
        JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id
        JOIN sys.columns c ON c.object_id = t.object_id AND c.column_id = ic.column_id
        WHERE t.schema_id = SCHEMA_ID('dbo') AND t.name IN (${tableList})
        ORDER BY ic.key_ordinal`);
      const trg = await pool.request().query(`
        SELECT DISTINCT OBJECT_NAME(parent_id) AS table_name
        FROM sys.triggers WHERE is_disabled = 0 AND parent_class = 1`);

      const schema = new Map<string, TableInfo>();
      for (const r of cols.recordset) {
        let info = schema.get(r.table_name);
        if (!info) {
          info = {
            name: r.table_name,
            columns: new Map(),
            columnOrder: [],
            primaryKey: [],
            hasTriggers: false,
          };
          schema.set(r.table_name, info);
        }
        const type = String(r.type_name).toLowerCase();
        let sqlType = type.toUpperCase();
        if (type === 'nvarchar' || type === 'nchar') {
          sqlType += r.max_length === -1 ? '(MAX)' : `(${r.max_length / 2})`;
        } else if (type === 'varchar' || type === 'char') {
          sqlType += r.max_length === -1 ? '(MAX)' : `(${r.max_length})`;
        } else if (type === 'decimal' || type === 'numeric') {
          sqlType += `(${r.precision},${r.scale})`;
        }
        info.columns.set(r.column_name, {
          name: r.column_name,
          type,
          sqlType,
          nullable: Boolean(r.is_nullable),
          isJson: (JSON_COLUMNS[r.table_name] || []).includes(r.column_name),
        });
        info.columnOrder.push(r.column_name);
      }
      for (const r of pks.recordset) schema.get(r.table_name)?.primaryKey.push(r.column_name);
      for (const r of trg.recordset) {
        const info = schema.get(r.table_name);
        if (info) info.hasTriggers = true;
      }
      for (const t of ALLOWED_TABLES) {
        if (!schema.has(t)) throw new Error(`Table dbo.${t} not found in SQL Server database`);
      }
      return schema;
    })().catch((err) => {
      schemaPromise = null;
      throw err;
    });
  }
  return schemaPromise;
}

class QueryError extends Error {
  constructor(message: string, public status = 400, public code = 'PGRST100') {
    super(message);
  }
}

const q = (name: string) => `[${name.replace(/]/g, ']]')}]`;

function requireColumn(table: TableInfo, column: string): ColumnInfo {
  const col = table.columns.get(column);
  if (!col) {
    throw new QueryError(
      `Could not find the '${column}' column of '${table.name}' in the schema cache`,
      400,
      'PGRST204'
    );
  }
  return col;
}

function parseColumnList(table: TableInfo, columns: string | undefined): string[] {
  const raw = (columns || '*').trim();
  if (raw === '*' || raw === '') return table.columnOrder;
  const names = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.includes('*')) return table.columnOrder;
  return names.map((n) => requireColumn(table, n).name);
}

/** Convert one incoming value into something SQL Server accepts for this column. */
function toDbValue(col: ColumnInfo, value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (col.isJson) {
    if (typeof value === 'string') {
      try {
        return JSON.parse(value);
      } catch {
        throw new QueryError(`Invalid JSON for column ${col.name}`);
      }
    }
    return value;
  }
  switch (col.type) {
    case 'bit':
      if (typeof value === 'string') {
        const s = value.trim().toLowerCase();
        if (['true', 't', '1', 'yes'].includes(s)) return true;
        if (['false', 'f', '0', 'no'].includes(s)) return false;
        if (s === '') return null;
      }
      return Boolean(value);
    case 'int':
    case 'bigint':
    case 'smallint':
    case 'tinyint':
    case 'decimal':
    case 'numeric':
    case 'float':
    case 'real':
      if (typeof value === 'string' && value.trim() === '') return null;
      return typeof value === 'number' ? value : Number(value);
    case 'date':
    case 'datetime2':
    case 'datetime':
    case 'datetimeoffset': {
      if (value instanceof Date) return value.toISOString();
      const s = String(value).trim();
      if (s === '') return null;
      // Postgres style "...12:34:56.789+00" offset -> "+00:00" (only when a time part is present,
      // so plain dates like "2026-11-05" are left alone)
      return /\d{2}:\d{2}(:\d{2}(\.\d+)?)?[+-]\d{2}$/.test(s) ? `${s}:00` : s;
    }
    case 'uniqueidentifier': {
      const s = String(value).trim();
      return s === '' ? null : s;
    }
    default:
      return typeof value === 'string' ? value : String(value);
  }
}

/** Convert a SQL Server row into the shape Supabase/PostgREST would return. */
function fromDbRow(table: TableInfo, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    const col = table.columns.get(key);
    if (!col || value === null || value === undefined) {
      out[key] = value ?? null;
      continue;
    }
    if (col.isJson && typeof value === 'string') {
      try {
        out[key] = JSON.parse(value);
      } catch {
        out[key] = value;
      }
    } else if (col.type === 'date' && value instanceof Date) {
      out[key] = value.toISOString().slice(0, 10);
    } else if (value instanceof Date) {
      out[key] = value.toISOString();
    } else if (col.type === 'uniqueidentifier') {
      out[key] = String(value).toLowerCase();
    } else {
      out[key] = value;
    }
  }
  return out;
}

class ParamBag {
  private n = 0;
  constructor(private readonly request: import('mssql').Request) {}
  add(col: ColumnInfo | null, value: unknown): string {
    // "@p0, @p1..." clash with names the msnodesqlv8 driver declares itself
    const name = `arg_${this.n++}`;
    const m = mssql!;
    if (col?.isJson) {
      this.request.input(name, m.NVarChar(m.MAX), value === null ? null : JSON.stringify(value));
    } else if (col && (col.type === 'nvarchar' || col.type === 'nchar')) {
      this.request.input(name, m.NVarChar(m.MAX), value === null ? null : String(value));
    } else if (typeof value === 'string') {
      this.request.input(name, m.NVarChar(m.MAX), value);
    } else {
      this.request.input(name, value as any);
    }
    return `@${name}`;
  }
}

function buildWhere(table: TableInfo, filters: DbFilter[] | undefined, params: ParamBag): string {
  if (!filters || filters.length === 0) return '';
  const parts = filters.map((f) => {
    const col = requireColumn(table, f.column);
    const c = q(col.name);
    const v = f.op === 'in' || f.op === 'is' ? f.value : toDbValue(col, f.value);
    switch (f.op) {
      case 'eq':
        return v === null ? `${c} IS NULL` : `${c} = ${params.add(col, v)}`;
      case 'neq':
        return v === null ? `${c} IS NOT NULL` : `(${c} <> ${params.add(col, v)} OR ${c} IS NULL)`;
      case 'gt':
        return `${c} > ${params.add(col, v)}`;
      case 'gte':
        return `${c} >= ${params.add(col, v)}`;
      case 'lt':
        return `${c} < ${params.add(col, v)}`;
      case 'lte':
        return `${c} <= ${params.add(col, v)}`;
      case 'ilike': // database collation is case-insensitive
        return `${c} LIKE ${params.add(null, String(f.value))}`;
      case 'like':
        return `${c} COLLATE Latin1_General_100_CS_AS_SC LIKE ${params.add(null, String(f.value))}`;
      case 'in': {
        const list = Array.isArray(f.value) ? f.value : [];
        if (list.length === 0) return '1 = 0';
        return `${c} IN (${list.map((x) => params.add(col, toDbValue(col, x))).join(', ')})`;
      }
      case 'is':
        if (f.value === null) return `${c} IS NULL`;
        return `${c} = ${params.add(col, toDbValue(col, f.value))}`;
      default:
        throw new QueryError(`Unsupported filter operator: ${String(f.op)}`);
    }
  });
  return ` WHERE ${parts.join(' AND ')}`;
}

function buildOrder(table: TableInfo, spec: DbQuerySpec, needed: boolean): string {
  const order = (spec.order || []).map(
    (o) => `${q(requireColumn(table, o.column).name)} ${o.ascending ? 'ASC' : 'DESC'}`
  );
  if (order.length === 0 && needed) {
    // OFFSET/FETCH needs an ORDER BY; use the primary key for stable paging
    order.push(...(table.primaryKey.length ? table.primaryKey : [table.columnOrder[0]]).map((k) => `${q(k)} ASC`));
  }
  return order.length ? ` ORDER BY ${order.join(', ')}` : '';
}

async function runSelect(table: TableInfo, spec: DbQuerySpec): Promise<DbResult> {
  const pool = await getPool();
  const columns = parseColumnList(table, spec.columns);
  const paging = spec.range
    ? { offset: spec.range.from, fetch: spec.range.to - spec.range.from + 1 }
    : spec.limit !== undefined
      ? { offset: 0, fetch: spec.limit }
      : null;

  const req = pool.request();
  const params = new ParamBag(req);
  const where = buildWhere(table, spec.filters, params);
  let sqlText = '';
  if (spec.count === 'exact') {
    sqlText += `SELECT COUNT(*) AS total FROM dbo.${q(table.name)}${where};\n`;
  }
  if (!spec.head) {
    sqlText += `SELECT ${columns.map(q).join(', ')} FROM dbo.${q(table.name)}${where}`;
    sqlText += buildOrder(table, spec, Boolean(paging));
    if (paging) {
      sqlText += ` OFFSET ${Math.max(0, Math.floor(paging.offset))} ROWS FETCH NEXT ${Math.max(0, Math.floor(paging.fetch))} ROWS ONLY`;
    }
  }
  const result = await req.query(sqlText);
  const sets = result.recordsets as unknown as Record<string, unknown>[][];
  const count = spec.count === 'exact' ? Number(sets[0]?.[0]?.total ?? 0) : null;
  const rows = spec.head ? null : (sets[spec.count === 'exact' ? 1 : 0] || []).map((r) => fromDbRow(table, r));
  return { data: rows, error: null, count, status: 200, statusText: 'OK' };
}

function resolveConflictTarget(table: TableInfo, onConflict?: string): string[] {
  if (!onConflict) return table.primaryKey;
  const cols = onConflict.split(',').map((s) => s.trim()).filter(Boolean);
  cols.forEach((c) => requireColumn(table, c));
  const allowed = [table.primaryKey, ...(ALLOWED_CONFLICT_TARGETS[table.name] || [])];
  const ok = allowed.some((a) => a.length === cols.length && a.every((c) => cols.includes(c)));
  if (!ok) {
    throw new QueryError(
      `there is no unique or exclusion constraint matching the ON CONFLICT specification (${onConflict})`,
      400,
      '42P10'
    );
  }
  return cols;
}

/** INSERT or UPSERT a batch of rows using one JSON parameter + OPENJSON. */
async function runWrite(table: TableInfo, spec: DbQuerySpec): Promise<DbResult> {
  const pool = await getPool();
  const inputRows = (spec.rows || []).filter((r) => r && typeof r === 'object');
  if (inputRows.length === 0) {
    return { data: spec.returning ? [] : null, error: null, count: null, status: 201, statusText: 'Created' };
  }

  // Normalise rows: drop unknown columns (logged), convert values
  const unknown = new Set<string>();
  const rows = inputRows.map((r) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) {
      const col = table.columns.get(k);
      if (!col) {
        unknown.add(k);
        continue;
      }
      const converted = toDbValue(col, v);
      if (converted !== undefined) out[k] = converted;
    }
    return out;
  });
  if (unknown.size) {
    console.warn(`[sqlserver] ${table.name}: ignored unknown columns ${[...unknown].join(', ')}`);
  }

  const conflict = spec.action === 'upsert' ? resolveConflictTarget(table, spec.onConflict) : [];

  // Group rows by the set of columns they provide, so a missing key means
  // "use the column default" rather than "set NULL" (PostgREST behaviour).
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const r of rows) {
    const key = Object.keys(r).sort().join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const returned: Record<string, unknown>[] = [];
  const tx = new mssql!.Transaction(pool);
  await tx.begin();
  try {
    for (const [key, groupRows0] of groups) {
      const cols = key ? key.split('|') : [];
      if (cols.length === 0) continue;
      const isUpsert = spec.action === 'upsert' && conflict.every((c) => cols.includes(c));

      // De-duplicate on the conflict key (last row wins), like a sequence of upserts
      let groupRows = groupRows0;
      if (isUpsert) {
        const byKey = new Map<string, Record<string, unknown>>();
        for (const r of groupRows0) byKey.set(JSON.stringify(conflict.map((c) => r[c])), r);
        groupRows = [...byKey.values()];
      }

      const withClause = cols
        .map((c) => {
          const col = table.columns.get(c)!;
          const path = `'$."${c.replace(/'/g, "''")}"'`;
          return col.isJson ? `${q(c)} NVARCHAR(MAX) ${path} AS JSON` : `${q(c)} ${col.sqlType} ${path}`;
        })
        .join(', ');
      const source = `SELECT * FROM OPENJSON(@rows) WITH (${withClause})`;
      const req = new mssql!.Request(tx);
      req.input('rows', mssql!.NVarChar(mssql!.MAX), JSON.stringify(groupRows));
      const useOutput = spec.returning && !table.hasTriggers;
      const output = useOutput ? ` OUTPUT INSERTED.*` : '';

      let sqlText: string;
      if (isUpsert) {
        const on = conflict.map((c) => `tgt.${q(c)} = src.${q(c)}`).join(' AND ');
        const updatable = cols.filter((c) => !conflict.includes(c));
        const setClause = (updatable.length ? updatable : conflict)
          .map((c) => `tgt.${q(c)} = src.${q(c)}`)
          .join(', ');
        sqlText =
          `MERGE dbo.${q(table.name)} WITH (HOLDLOCK) AS tgt USING (${source}) AS src ON ${on} ` +
          `WHEN MATCHED THEN UPDATE SET ${setClause} ` +
          `WHEN NOT MATCHED THEN INSERT (${cols.map(q).join(', ')}) VALUES (${cols.map((c) => `src.${q(c)}`).join(', ')})` +
          `${output};`;
      } else {
        sqlText = `INSERT INTO dbo.${q(table.name)} (${cols.map(q).join(', ')})${output} ${source};`;
      }

      const res = await req.query(sqlText);
      if (spec.returning) {
        if (useOutput) {
          returned.push(...(res.recordset || []));
        } else {
          // Table has triggers (OUTPUT not allowed): read the rows back by key
          const keyCols = isUpsert ? conflict : table.primaryKey;
          if (keyCols.every((c) => cols.includes(c))) {
            const back = new mssql!.Request(tx);
            back.input('rows', mssql!.NVarChar(mssql!.MAX), JSON.stringify(groupRows));
            const keyWith = keyCols
              .map((c) => `${q(c)} ${table.columns.get(c)!.sqlType} '$."${c}"'`)
              .join(', ');
            const match = keyCols.map((c) => `t.${q(c)} = k.${q(c)}`).join(' AND ');
            const r2 = await back.query(
              `SELECT t.* FROM dbo.${q(table.name)} t WHERE EXISTS (SELECT 1 FROM OPENJSON(@rows) WITH (${keyWith}) k WHERE ${match})`
            );
            returned.push(...(r2.recordset || []));
          }
        }
      }
    }
    await tx.commit();
  } catch (err) {
    try {
      await tx.rollback();
    } catch {
      // already rolled back by SQL Server
    }
    throw err;
  }

  bumpVersion(table.name);
  const projected = spec.returning ? projectRows(table, returned, spec.columns) : null;
  return { data: projected, error: null, count: null, status: 201, statusText: 'Created' };
}

function projectRows(table: TableInfo, rows: Record<string, unknown>[], columns?: string) {
  const wanted = parseColumnList(table, columns);
  return rows.map((r) => {
    const full = fromDbRow(table, r);
    const out: Record<string, unknown> = {};
    for (const c of wanted) out[c] = full[c] ?? null;
    return out;
  });
}

async function runUpdate(table: TableInfo, spec: DbQuerySpec): Promise<DbResult> {
  if (!spec.filters?.length) throw new QueryError('UPDATE requires a WHERE clause', 400, '21000');
  const pool = await getPool();
  const req = pool.request();
  const params = new ParamBag(req);
  const sets: string[] = [];
  for (const [k, v] of Object.entries(spec.values || {})) {
    const col = table.columns.get(k);
    if (!col) {
      console.warn(`[sqlserver] ${table.name}: ignored unknown column ${k} in update`);
      continue;
    }
    const converted = toDbValue(col, v);
    if (converted === undefined) continue;
    sets.push(`${q(k)} = ${params.add(col, converted)}`);
  }
  if (!sets.length) return { data: spec.returning ? [] : null, error: null, count: null, status: 204, statusText: 'No Content' };
  const where = buildWhere(table, spec.filters, params);
  const useOutput = spec.returning && !table.hasTriggers;
  const result = await req.query(
    `UPDATE dbo.${q(table.name)} SET ${sets.join(', ')}${useOutput ? ' OUTPUT INSERTED.*' : ''}${where}`
  );
  bumpVersion(table.name);
  let data: unknown = null;
  if (spec.returning) {
    data = useOutput
      ? projectRows(table, result.recordset || [], spec.columns)
      : (await runSelect(table, { ...spec, action: 'select', count: null })).data;
  }
  return { data, error: null, count: null, status: spec.returning ? 200 : 204, statusText: 'OK' };
}

async function runDelete(table: TableInfo, spec: DbQuerySpec): Promise<DbResult> {
  if (!spec.filters?.length) throw new QueryError('DELETE requires a WHERE clause', 400, '21000');
  const pool = await getPool();
  const req = pool.request();
  const params = new ParamBag(req);
  const where = buildWhere(table, spec.filters, params);
  const useOutput = spec.returning && !table.hasTriggers;
  const result = await req.query(
    `DELETE FROM dbo.${q(table.name)}${useOutput ? ' OUTPUT DELETED.*' : ''}${where}`
  );
  bumpVersion(table.name);
  if (table.name === 'noodle_activations') bumpVersion('noodle_activation_sku_details');
  return {
    data: useOutput ? projectRows(table, result.recordset || [], spec.columns) : spec.returning ? [] : null,
    error: null,
    count: null,
    status: spec.returning ? 200 : 204,
    statusText: 'OK',
  };
}

function bumpVersion(table: string) {
  tableVersions[table] = (tableVersions[table] || 0) + 1;
  if (table === 'noodle_activations') {
    tableVersions.noodle_activation_sku_details = (tableVersions.noodle_activation_sku_details || 0) + 1;
  }
}

export function getTableVersions(): Record<string, number> {
  return { __instance: instanceId, ...tableVersions };
}

function toDbError(err: unknown): { error: DbError; status: number } {
  if (err instanceof QueryError) {
    return { error: { message: err.message, code: err.code, details: null, hint: null }, status: err.status };
  }
  const e = err as { message?: string; number?: number; code?: string; originalError?: { message?: string } };
  const message = e?.originalError?.message || e?.message || String(err);
  // SQL Server error numbers -> PostgREST-like codes the app may check
  const code =
    e?.number === 2627 || e?.number === 2601
      ? '23505' // unique violation
      : e?.number === 547
        ? '23503' // foreign key / check violation
        : e?.number === 515
          ? '23502' // not null violation
          : e?.code || 'MSSQL';
  const status = ['23505', '23503', '23502'].includes(code) ? 409 : 500;
  return { error: { message, code, details: e?.number ? `SQL Server error ${e.number}` : null, hint: null }, status };
}

/** Broken/stale connection (DB restarted, network blip) — safe to reconnect and retry. */
function isConnectionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string; originalError?: { message?: string } };
  const text = `${e?.code || ''} ${e?.message || ''} ${e?.originalError?.message || ''}`;
  return /ECONNCLOSED|ECONNRESET|ESOCKET|ENOTOPEN|ETIMEOUT|Communication link failure|Named Pipes Provider|TCP Provider|Login timeout expired|Query timeout expired|connection is closed|Connection is closed|transport-level error/i.test(
    text
  );
}

async function resetPool(): Promise<void> {
  const old = poolPromise;
  poolPromise = null;
  try {
    (await old)?.close();
  } catch {
    // already broken
  }
}

export async function executeDbQuery(spec: DbQuerySpec): Promise<DbResult> {
  const first = await executeDbQueryOnce(spec);
  // A plain INSERT is not retried: if the first attempt reached the server we could save twice.
  // SELECT / UPSERT (MERGE) / UPDATE / DELETE give the same result when repeated.
  if (first.error?.code === 'RETRY' && spec?.action !== 'insert') {
    console.warn('[sqlserver] connection lost, reconnecting and retrying once');
    await resetPool();
    const second = await executeDbQueryOnce(spec);
    if (second.error?.code === 'RETRY') second.error.code = 'MSSQL';
    return second;
  }
  if (first.error?.code === 'RETRY') {
    await resetPool();
    first.error.code = 'MSSQL';
  }
  return first;
}

async function executeDbQueryOnce(spec: DbQuerySpec): Promise<DbResult> {
  try {
    if (!spec || typeof spec !== 'object') throw new QueryError('Invalid query');
    if (!(ALLOWED_TABLES as readonly string[]).includes(spec.table)) {
      throw new QueryError(`Table '${String(spec.table)}' is not available`, 404, '42P01');
    }
    const schema = await getSchema();
    const table = schema.get(spec.table)!;
    switch (spec.action) {
      case 'select':
        return await runSelect(table, spec);
      case 'insert':
      case 'upsert':
        return await runWrite(table, spec);
      case 'update':
        return await runUpdate(table, spec);
      case 'delete':
        return await runDelete(table, spec);
      default:
        throw new QueryError(`Unsupported action: ${String(spec.action)}`);
    }
  } catch (err) {
    const { error, status } = toDbError(err);
    if (isConnectionError(err)) {
      error.code = 'RETRY'; // handled by executeDbQuery
    } else if (status >= 500) {
      console.error('[sqlserver]', spec?.action, spec?.table, '-', error.message);
    }
    return { data: null, error, count: null, status, statusText: 'Error' };
  }
}

/** Executor for server-side code (server.ts) — no HTTP round trip. */
export const serverSqlExecutor: DbExecutor = {
  query: executeDbQuery,
  versions: async () => getTableVersions(),
};

export async function checkSqlServerConnection(): Promise<string> {
  const pool = await getPool();
  const r = await pool.request().query('SELECT DB_NAME() AS db, @@SERVERNAME AS server');
  await getSchema();
  return `${r.recordset[0].server} / ${r.recordset[0].db}`;
}
