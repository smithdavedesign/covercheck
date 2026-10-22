import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { neon } from '@neondatabase/serverless';
import type { PGlite } from '@electric-sql/pglite';

/**
 * The one database surface the app uses: parameterized queries plus an atomic batch.
 * Production runs on Neon Postgres over HTTP; local dev and tests run the same SQL on PGlite.
 *
 * Drivers disagree on value types (Neon returns bigints as strings, PGlite returns dates as
 * `Date`), so queries cast what they return: dates `::text`, counts `::int`.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  /** Runs parameterless statements in order, in one transaction. */
  transaction(statements: string[]): Promise<void>;
}

/** Where `next dev` keeps its database when DATABASE_URL is not set. */
const LOCAL_DATA_DIR = '.data/pglite';
/** Serializes schema setup when several cold starts run it at once. */
const SCHEMA_LOCK = 'SELECT pg_advisory_xact_lock(4210211)';

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS associations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    contact_email text NOT NULL,
    requirements jsonb NOT NULL,
    key_hash text NOT NULL UNIQUE,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS vendors (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    association_id uuid NOT NULL REFERENCES associations (id) ON DELETE CASCADE,
    name text NOT NULL,
    contact_email text NOT NULL,
    agent_email text,
    created_at timestamptz NOT NULL DEFAULT now(),
    removed_at timestamptz
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS vendors_active_name ON vendors (association_id, lower(name)) WHERE removed_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS checks (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vendor_id uuid NOT NULL REFERENCES vendors (id) ON DELETE CASCADE,
    checked_on date NOT NULL,
    verdict text NOT NULL CHECK (verdict IN ('pass', 'fail')),
    expiry_date date,
    results jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS checks_vendor_latest ON checks (vendor_id, id DESC)`,
  `CREATE TABLE IF NOT EXISTS reminders (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    vendor_id uuid NOT NULL REFERENCES vendors (id) ON DELETE CASCADE,
    expiry_date date NOT NULL,
    window_days int NOT NULL,
    to_email text NOT NULL,
    cc_email text,
    status text NOT NULL DEFAULT 'sending' CHECK (status IN ('sending', 'sent')),
    created_at timestamptz NOT NULL DEFAULT now(),
    sent_at timestamptz,
    UNIQUE (vendor_id, expiry_date, window_days)
  )`,
  // Anonymous daily counters for the demand test: no association, person or content, just how many.
  `CREATE TABLE IF NOT EXISTS usage_counts (
    day date NOT NULL,
    kind text NOT NULL CHECK (kind IN ('upload', 'pass', 'fail')),
    count int NOT NULL,
    PRIMARY KEY (day, kind)
  )`,
];

export async function migrate(db: Db): Promise<void> {
  await db.transaction([SCHEMA_LOCK, ...SCHEMA]);
}

export function pgliteDb(pg: PGlite): Db {
  return {
    query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows,
    transaction: (statements) =>
      pg.transaction(async (tx) => {
        for (const statement of statements) await tx.query(statement);
      }),
  };
}

function neonDb(url: string): Db {
  const sql = neon(url);
  return {
    query: async <T>(text: string, params: unknown[] = []) => (await sql.query(text, params)) as T[],
    transaction: async (statements) => {
      await sql.transaction(statements.map((statement) => sql.query(statement)));
    },
  };
}

type Env = Record<string, string | undefined>;

/**
 * Neon when DATABASE_URL is set; otherwise a local PGlite database, which is never acceptable on Vercel.
 * PGLITE_DIR moves the local database (the screenshot script uses a throwaway one).
 */
export async function connect(env: Env): Promise<Db> {
  let db: Db;
  if (env.DATABASE_URL) {
    db = neonDb(env.DATABASE_URL);
  } else if (env.VERCEL) {
    throw new Error('DATABASE_URL is not set; refusing to use a throwaway database in a deployment.');
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dataDir = env.PGLITE_DIR || LOCAL_DATA_DIR;
    // PGlite creates its own directory but not missing parents, and a fresh clone has no .data/.
    if (!dataDir.includes('://')) await mkdir(dirname(dataDir), { recursive: true });
    db = pgliteDb(new PGlite(dataDir));
  }
  await migrate(db);
  return db;
}

let current: Promise<Db> | null = null;

export function getDb(): Promise<Db> {
  if (!current) {
    const pending = connect(process.env);
    // A failed connection is retried on the next request rather than cached.
    pending.catch(() => {
      if (current === pending) current = null;
    });
    current = pending;
  }
  return current;
}

/** Swaps in another database (tests); `null` goes back to the environment's. */
export function setDb(db: Db | null): void {
  current = db ? Promise.resolve(db) : null;
}
