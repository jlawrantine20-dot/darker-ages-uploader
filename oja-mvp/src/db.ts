import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** The query surface every service uses. Works the same inside and outside a transaction. */
export interface Q {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Q {
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
}

/** Postgres over the network (Supabase or any Postgres). */
export async function postgresDb(connectionString: string): Promise<Db> {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({ connectionString });
  return {
    async query(sql, params) {
      return (await pool.query(sql, params as unknown[])).rows;
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn({ query: async (sql, params) => (await client.query(sql, params as unknown[])).rows });
        await client.query('commit');
        return out;
      } catch (err) {
        await client.query('rollback');
        throw err;
      } finally {
        client.release();
      }
    },
    async exec(sql) {
      await pool.query(sql);
    },
    close: () => pool.end(),
  };
}

/** Postgres compiled to WASM, in-process. Used for tests, the simulator and local dev. */
export async function embeddedDb(dataDir?: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  const wrap = (x: { query: (s: string, p?: unknown[]) => Promise<{ rows: unknown[] }> }): Q => ({
    query: async <T>(sql: string, params?: unknown[]) => (await x.query(sql, params)).rows as T[],
  });
  return {
    ...wrap(db),
    tx: (fn) => db.transaction((t) => fn(wrap(t))),
    async exec(sql) {
      await db.exec(sql);
    },
    close: () => db.close(),
  };
}

export async function migrate(db: Db): Promise<void> {
  const dir = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'db', 'migrations');
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(dir, file), 'utf8'));
  }
}
