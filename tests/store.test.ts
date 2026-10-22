import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_REQUIREMENTS } from '../lib/schema';
import {
  MAX_VENDORS_PER_ASSOCIATION,
  addVendor,
  associationForKey,
  certificateExpiry,
  findVendor,
  hashKey,
  listVendors,
  removeVendor,
  vendorStatus,
} from '../lib/store';
import { seedAssociation, seedCheck, seedVendor, testDb, type TestDb } from './helpers/db';
import { TODAY, addDays, compliantFields } from './helpers/fixtures';

let t: TestDb;

beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());
beforeEach(() => t.reset());

describe('associations and keys', () => {
  it('finds the association by its key and stores only the key’s hash', async () => {
    const { association, key } = await seedAssociation(t.db);
    expect(key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await associationForKey(t.db, key)).toEqual(association);
    expect(association.requirements).toEqual({ ...DEFAULT_REQUIREMENTS, certificateHolder: 'Maple Ridge HOA' });

    const rows = await t.db.query<{ key_hash: string }>('SELECT key_hash FROM associations');
    expect(rows).toEqual([{ key_hash: hashKey(key) }]);
    expect(JSON.stringify(rows)).not.toContain(key);
  });

  it('finds nothing for a wrong or malformed key', async () => {
    const { key } = await seedAssociation(t.db);
    const wrong = key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A');
    expect(await associationForKey(t.db, wrong)).toBeNull();
    expect(await associationForKey(t.db, '')).toBeNull();
    expect(await associationForKey(t.db, "x' OR '1'='1")).toBeNull();
  });

  it('gives every association its own key', async () => {
    const a = await seedAssociation(t.db);
    const b = await seedAssociation(t.db, { name: 'Oak Hollow Condo Association' });
    expect(a.key).not.toBe(b.key);
    expect((await associationForKey(t.db, b.key))?.name).toBe('Oak Hollow Condo Association');
  });
});

describe('vendors', () => {
  it('adds a vendor with no certificate on file', async () => {
    const { association } = await seedAssociation(t.db);
    const vendor = await seedVendor(t.db, association.id);
    expect(vendor).toMatchObject({
      name: 'Acme Landscaping',
      contactEmail: 'office@acmelandscaping.example',
      agentEmail: 'certs@agent-acmelandscaping.example',
      expiryDate: null,
      verdict: null,
      checkedOn: null,
      failedReasons: [],
    });
    expect(await findVendor(t.db, association.id, vendor.id)).toEqual(vendor);
  });

  it('refuses a second active vendor with the same name, ignoring case and spacing', async () => {
    const { association } = await seedAssociation(t.db);
    await seedVendor(t.db, association.id, { name: 'Acme Landscaping' });
    const again = await addVendor(t.db, association.id, { name: '  ACME landscaping ', contactEmail: 'a@b.example', agentEmail: null });
    expect(again).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('allows the same vendor name in another association, and again after removal', async () => {
    const a = await seedAssociation(t.db);
    const b = await seedAssociation(t.db, { name: 'Oak Hollow Condo Association' });
    const first = await seedVendor(t.db, a.association.id);
    await seedVendor(t.db, b.association.id);
    expect(await removeVendor(t.db, a.association.id, first.id)).toBe(true);
    await expect(seedVendor(t.db, a.association.id)).resolves.toMatchObject({ name: 'Acme Landscaping' });
  });

  it('caps the number of active vendors per association', async () => {
    const { association } = await seedAssociation(t.db);
    await t.db.query(
      `INSERT INTO vendors (association_id, name, contact_email)
       SELECT $1, 'Vendor ' || n, 'v' || n || '@example.com' FROM generate_series(1, $2::int) AS n`,
      [association.id, MAX_VENDORS_PER_ASSOCIATION],
    );
    const result = await addVendor(t.db, association.id, { name: 'One Too Many', contactEmail: 'x@example.com', agentEmail: null });
    expect(result).toEqual({ ok: false, reason: 'limit' });
  });

  it('removes a vendor only within its own association, once', async () => {
    const a = await seedAssociation(t.db);
    const b = await seedAssociation(t.db, { name: 'Oak Hollow Condo Association' });
    const vendor = await seedVendor(t.db, a.association.id);
    expect(await removeVendor(t.db, b.association.id, vendor.id)).toBe(false);
    expect(await removeVendor(t.db, a.association.id, vendor.id)).toBe(true);
    expect(await removeVendor(t.db, a.association.id, vendor.id)).toBe(false);
    expect(await listVendors(t.db, a.association.id)).toEqual([]);
    expect(await findVendor(t.db, a.association.id, vendor.id)).toBeNull();
  });

  it('never returns another association’s vendor', async () => {
    const a = await seedAssociation(t.db);
    const b = await seedAssociation(t.db, { name: 'Oak Hollow Condo Association' });
    const vendor = await seedVendor(t.db, a.association.id);
    expect(await findVendor(t.db, b.association.id, vendor.id)).toBeNull();
    expect(await listVendors(t.db, b.association.id)).toEqual([]);
  });
});

describe('checks and the vendor list', () => {
  it('takes expiry, verdict and failed reasons from the latest check', async () => {
    const { association } = await seedAssociation(t.db);
    const vendor = await seedVendor(t.db, association.id);
    await seedCheck(t.db, vendor.id, '2026-11-01', { failedReasons: ['each-occurrence limit $500,000 is below the required $1,000,000'] });
    await seedCheck(t.db, vendor.id, '2027-11-01', { checkedOn: TODAY });
    const [latest] = await listVendors(t.db, association.id);
    expect(latest).toMatchObject({ expiryDate: '2027-11-01', verdict: 'pass', checkedOn: TODAY, failedReasons: [] });
  });

  it('lists failed reasons from a failing check', async () => {
    const { association } = await seedAssociation(t.db);
    const vendor = await seedVendor(t.db, association.id);
    await seedCheck(t.db, vendor.id, '2027-01-01', { failedReasons: ['a', 'b'] });
    expect(await findVendor(t.db, association.id, vendor.id)).toMatchObject({ verdict: 'fail', failedReasons: ['a', 'b'] });
  });

  it('orders vendors by expiry ascending, with vendors without a certificate last', async () => {
    const { association } = await seedAssociation(t.db);
    const plan: [string, string | null | undefined][] = [
      ['Delta Plumbing', '2027-05-01'],
      ['Echo Electric', undefined],
      ['Bravo Roofing', '2026-11-15'],
      ['Charlie Paving', null],
      ['Alpha Pools', '2026-10-01'],
    ];
    for (const [name, expiry] of plan) {
      const vendor = await seedVendor(t.db, association.id, { name });
      if (expiry !== undefined) await seedCheck(t.db, vendor.id, expiry);
    }
    const names = (await listVendors(t.db, association.id)).map((v) => v.name);
    expect(names).toEqual(['Alpha Pools', 'Bravo Roofing', 'Delta Plumbing', 'Charlie Paving', 'Echo Electric']);
  });
});

describe('certificateExpiry', () => {
  it('is the general liability expiry when workers’ comp is not required', () => {
    const fields = compliantFields({ workersComp: { carrier: 'X', policyNumber: 'WC-1', effectiveDate: null, expiryDate: '2026-12-01' } });
    expect(certificateExpiry(fields, { ...DEFAULT_REQUIREMENTS, workersCompRequired: false })).toBe('2027-03-01');
  });

  it('is the earlier of general liability and workers’ comp when workers’ comp is required', () => {
    const fields = compliantFields({ workersComp: { carrier: 'X', policyNumber: 'WC-1', effectiveDate: null, expiryDate: '2026-12-01' } });
    expect(certificateExpiry(fields, DEFAULT_REQUIREMENTS)).toBe('2026-12-01');
  });

  it('falls back to whichever date is present, or null', () => {
    expect(certificateExpiry(compliantFields({ workersComp: null }), DEFAULT_REQUIREMENTS)).toBe('2027-03-01');
    expect(
      certificateExpiry(compliantFields({ generalLiability: { expiryDate: null }, workersComp: null }), DEFAULT_REQUIREMENTS),
    ).toBeNull();
  });
});

describe('vendorStatus', () => {
  const warn = 30;
  it.each([
    [{ verdict: null, expiryDate: null }, 'no_certificate'],
    [{ verdict: 'pass', expiryDate: addDays(TODAY, 90) }, 'ok'],
    [{ verdict: 'pass', expiryDate: addDays(TODAY, 31) }, 'ok'],
    [{ verdict: 'pass', expiryDate: addDays(TODAY, 30) }, 'expiring'],
    [{ verdict: 'pass', expiryDate: addDays(TODAY, 1) }, 'expiring'],
    [{ verdict: 'pass', expiryDate: TODAY }, 'expired'],
    [{ verdict: 'pass', expiryDate: addDays(TODAY, -3) }, 'expired'],
    [{ verdict: 'fail', expiryDate: addDays(TODAY, -3) }, 'expired'],
    [{ verdict: 'fail', expiryDate: addDays(TODAY, 90) }, 'not_compliant'],
    [{ verdict: 'fail', expiryDate: addDays(TODAY, 10) }, 'not_compliant'],
    [{ verdict: 'fail', expiryDate: null }, 'not_compliant'],
  ] as const)('%o → %s', (vendor, status) => {
    expect(vendorStatus(vendor, TODAY, warn)).toBe(status);
  });
});
