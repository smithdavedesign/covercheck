import { existsSync, rmSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, migrate, pgliteDb, type Db } from '../lib/db';
import { listVendors } from '../lib/store';
import { seedAssociation, seedCheck, seedVendor } from './helpers/db';

/**
 * Probes the database layer's boundaries: the schema script, driver selection, and the
 * value types that cross from Postgres into the app (drivers disagree on dates and bigints).
 */
describe('database layer (lib/db.ts)', () => {
  let pg: PGlite;
  let db: Db;

  beforeAll(async () => {
    pg = new PGlite();
    db = pgliteDb(pg);
    await migrate(db);
  });
  afterAll(() => pg.close());

  it('applies the schema idempotently', async () => {
    await expect(migrate(db)).resolves.toBeUndefined();
    const tables = await db.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    expect(tables.map((t) => t.table_name)).toEqual(['associations', 'checks', 'reminders', 'usage_counts', 'vendors']);
  });

  it('returns dates as YYYY-MM-DD strings, not Date objects', async () => {
    const { association } = await seedAssociation(db);
    const vendor = await seedVendor(db, association.id);
    await seedCheck(db, vendor.id, '2027-03-01', { checkedOn: '2026-10-22' });
    const [listed] = await listVendors(db, association.id);
    expect(listed.expiryDate).toBe('2027-03-01');
    expect(listed.checkedOn).toBe('2026-10-22');
  });

  it('rolls back a failed transaction', async () => {
    await expect(db.transaction(['CREATE TABLE probe_a (id int)', 'SELECT * FROM missing_table'])).rejects.toThrow();
    expect(await db.query(`SELECT 1 FROM information_schema.tables WHERE table_name = 'probe_a'`)).toEqual([]);
  });

  it('refuses to run on Vercel without DATABASE_URL instead of falling back to a throwaway database', async () => {
    await expect(connect({ VERCEL: '1' })).rejects.toThrow(/DATABASE_URL/);
    await expect(connect({ VERCEL: '1', PGLITE_DIR: 'memory://' })).rejects.toThrow(/DATABASE_URL/);
  });

  it('puts the local database where PGLITE_DIR says, with the schema in place', async () => {
    const local = await connect({ PGLITE_DIR: 'memory://' });
    expect(await local.query('SELECT count(*)::int AS n FROM usage_counts')).toEqual([{ n: 0 }]);
  });

  it('creates missing parent directories for the local database (a fresh clone has no .data/)', async () => {
    // Inside the repo's gitignored .data/, removed afterwards.
    const root = `.data/test-${process.pid}`;
    try {
      const local = await connect({ PGLITE_DIR: `${root}/nested/pglite` });
      expect(await local.query('SELECT count(*)::int AS n FROM associations')).toEqual([{ n: 0 }]);
      expect(existsSync(`${root}/nested/pglite`)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
