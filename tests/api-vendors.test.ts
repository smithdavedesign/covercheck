import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as createAssociationRoute } from '../app/api/associations/route';
import { DELETE as deleteVendorRoute } from '../app/api/vendors/[id]/route';
import { POST as checkVendorRoute } from '../app/api/vendors/[id]/check/route';
import { GET as listVendorsRoute, POST as addVendorRoute } from '../app/api/vendors/route';
import { DISCLAIMER } from '../lib/check';
import { setDb } from '../lib/db';
import { DEFAULT_REQUIREMENTS } from '../lib/schema';
import { associationForKey } from '../lib/store';
import { seedAssociation, seedCheck, seedVendor, testDb, type TestDb } from './helpers/db';
import { addDays, compliantFields, utcToday } from './helpers/fixtures';

let t: TestDb;

beforeAll(async () => {
  t = await testDb();
  setDb(t.db);
});
afterAll(async () => {
  setDb(null);
  await t.close();
});
beforeEach(() => t.reset());

function request(path: string, init: { method?: string; key?: string | null; body?: unknown; raw?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (init.key) headers.authorization = `Bearer ${init.key}`;
  return new Request(`http://localhost${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.raw ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const farFuture = {
  generalLiability: { expiryDate: '2099-01-01' },
  workersComp: { carrier: 'Travelers Indemnity Company', policyNumber: 'WC-7654321', effectiveDate: '2026-01-01', expiryDate: '2098-06-01' },
};

describe('POST /api/associations', () => {
  it('creates an association and returns its private key', async () => {
    const response = await createAssociationRoute(
      request('/api/associations', { method: 'POST', body: { name: 'Maple Ridge HOA', contactEmail: 'treasurer@mapleridge.example' } }),
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.association).toMatchObject({ name: 'Maple Ridge HOA' });

    const stored = await associationForKey(t.db, body.key);
    expect(stored?.contactEmail).toBe('treasurer@mapleridge.example');
    // No requirements sent → default template, with the association as certificate holder.
    expect(stored?.requirements).toEqual({ ...DEFAULT_REQUIREMENTS, certificateHolder: 'Maple Ridge HOA' });
  });

  it('stores the board’s requirements, keeping an explicit certificate holder', async () => {
    const requirements = { ...DEFAULT_REQUIREMENTS, certificateHolder: 'Maple Ridge Homeowners Association, Inc.', workersCompRequired: false };
    const body = await (
      await createAssociationRoute(
        request('/api/associations', {
          method: 'POST',
          body: { name: 'Maple Ridge HOA', contactEmail: 'treasurer@mapleridge.example', requirements },
        }),
      )
    ).json();
    expect((await associationForKey(t.db, body.key))?.requirements).toEqual(requirements);
  });

  it.each([
    [{ contactEmail: 'treasurer@mapleridge.example' }, 'name'],
    [{ name: 'Maple Ridge HOA' }, 'contactEmail'],
    [{ name: 'Maple Ridge HOA', contactEmail: 'not an email' }, 'contactEmail'],
    [{ name: 'Maple Ridge\r\nBcc: x@example.com', contactEmail: 'treasurer@mapleridge.example' }, 'name'],
    [{ name: 'Maple Ridge HOA', contactEmail: 'treasurer@mapleridge.example', requirements: { expiryWarningDays: -1 } }, 'requirements.expiryWarningDays'],
  ])('rejects %o (bad %s)', async (body, path) => {
    const response = await createAssociationRoute(request('/api/associations', { method: 'POST', body }));
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe('invalid_request');
    expect(json.issues.map((i: { path: string }) => i.path)).toContain(path);
  });

  it('rejects a body that is not JSON', async () => {
    const response = await createAssociationRoute(request('/api/associations', { method: 'POST', raw: 'name=x' }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_json');
  });
});

describe('authentication', () => {
  it.each([
    ['no key', null],
    ['a malformed key', 'not-a-key'],
    ['an unknown key', 'A'.repeat(43)],
  ])('rejects %s with 401', async (_label, key) => {
    await seedAssociation(t.db);
    const response = await listVendorsRoute(request('/api/vendors', { key }));
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('unauthorized');
  });
});

describe('exit criterion 3: GET /api/vendors returns vendors ordered by expiry ascending', () => {
  it('orders by expiry ascending, with vendors that have no certificate last', async () => {
    const { association, key } = await seedAssociation(t.db);
    const today = utcToday();
    const plan: [string, number | null][] = [
      ['Delta Plumbing', 200],
      ['Echo Electric', null],
      ['Bravo Roofing', 12],
      ['Alpha Pools', -3],
      ['Charlie Paving', 45],
    ];
    for (const [name, days] of plan) {
      const vendor = await seedVendor(t.db, association.id, { name });
      if (days !== null) await seedCheck(t.db, vendor.id, addDays(today, days));
    }

    const response = await listVendorsRoute(request('/api/vendors', { key }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.vendors.map((v: { name: string }) => v.name)).toEqual([
      'Alpha Pools',
      'Bravo Roofing',
      'Charlie Paving',
      'Delta Plumbing',
      'Echo Electric',
    ]);
    const expiries = body.vendors.map((v: { expiryDate: string | null }) => v.expiryDate).filter(Boolean);
    expect(expiries).toEqual([...expiries].sort());
    expect(body.vendors.map((v: { status: string }) => v.status)).toEqual(['expired', 'expiring', 'ok', 'ok', 'no_certificate']);
    expect(body.vendors.map((v: { daysLeft: number | null }) => v.daysLeft)).toEqual([-3, 12, 45, 200, null]);
  });

  it('returns the association, today’s date and a ready-made request email per vendor', async () => {
    const { association, key } = await seedAssociation(t.db);
    const vendor = await seedVendor(t.db, association.id);
    await seedCheck(t.db, vendor.id, addDays(utcToday(), 90), { failedReasons: ['association not named as certificate holder'] });
    const body = await (await listVendorsRoute(request('/api/vendors', { key }))).json();
    expect(body.today).toBe(utcToday());
    expect(body.association).toEqual({
      name: 'Maple Ridge HOA',
      contactEmail: 'treasurer@mapleridge.example',
      requirements: association.requirements,
    });
    const [listed] = body.vendors;
    expect(listed).toMatchObject({
      id: vendor.id,
      status: 'not_compliant',
      statusLabel: 'Not compliant',
      failedReasons: ['association not named as certificate holder'],
    });
    expect(listed.requestHref).toMatch(/^mailto:office@acmelandscaping\.example\?cc=certs%40agent-acmelandscaping\.example&subject=/);
    expect(decodeURIComponent(listed.requestHref)).toContain('association not named as certificate holder');
  });

  it('lists only the authenticated association’s vendors', async () => {
    const a = await seedAssociation(t.db);
    const b = await seedAssociation(t.db, { name: 'Oak Hollow Condo Association' });
    await seedVendor(t.db, a.association.id, { name: 'Acme Landscaping' });
    await seedVendor(t.db, b.association.id, { name: 'Bright Roofing' });
    const body = await (await listVendorsRoute(request('/api/vendors', { key: b.key }))).json();
    expect(body.vendors.map((v: { name: string }) => v.name)).toEqual(['Bright Roofing']);
  });
});

describe('POST /api/vendors', () => {
  it('adds a vendor', async () => {
    const { key } = await seedAssociation(t.db);
    const response = await addVendorRoute(
      request('/api/vendors', {
        method: 'POST',
        key,
        body: { name: 'Acme Landscaping', contactEmail: 'office@acme.example', agentEmail: 'certs@agent.example' },
      }),
    );
    expect(response.status).toBe(201);
    const { vendor } = await response.json();
    expect(vendor).toMatchObject({ name: 'Acme Landscaping', contactEmail: 'office@acme.example', agentEmail: 'certs@agent.example', status: 'no_certificate' });
    const listed = await (await listVendorsRoute(request('/api/vendors', { key }))).json();
    expect(listed.vendors.map((v: { id: string }) => v.id)).toEqual([vendor.id]);
  });

  it('treats a blank agent email as none', async () => {
    const { key } = await seedAssociation(t.db);
    const response = await addVendorRoute(
      request('/api/vendors', { method: 'POST', key, body: { name: 'Acme Landscaping', contactEmail: 'office@acme.example', agentEmail: '' } }),
    );
    expect(response.status).toBe(201);
    expect((await response.json()).vendor.agentEmail).toBeNull();
  });

  it('rejects a duplicate vendor name with 409', async () => {
    const { association, key } = await seedAssociation(t.db);
    await seedVendor(t.db, association.id, { name: 'Acme Landscaping' });
    const response = await addVendorRoute(
      request('/api/vendors', { method: 'POST', key, body: { name: 'acme landscaping', contactEmail: 'office@acme.example' } }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe('duplicate_vendor');
  });

  it.each([
    [{ contactEmail: 'office@acme.example' }, 'name'],
    [{ name: 'Acme Landscaping' }, 'contactEmail'],
    [{ name: 'Acme Landscaping', contactEmail: 'office@acme.example', agentEmail: 'nope' }, 'agentEmail'],
    [{ name: 'Acme\nLandscaping', contactEmail: 'office@acme.example' }, 'name'],
    [{ name: 'Acme Landscaping', contactEmail: 'office@acme.example?bcc=x@example.com' }, 'contactEmail'],
  ])('rejects %o (bad %s)', async (body, path) => {
    const { key } = await seedAssociation(t.db);
    const response = await addVendorRoute(request('/api/vendors', { method: 'POST', key, body }));
    expect(response.status).toBe(400);
    expect((await response.json()).issues.map((i: { path: string }) => i.path)).toContain(path);
  });

  it('requires the key', async () => {
    const response = await addVendorRoute(request('/api/vendors', { method: 'POST', body: { name: 'A', contactEmail: 'a@b.example' } }));
    expect(response.status).toBe(401);
  });
});

describe('DELETE /api/vendors/:id', () => {
  it('removes the vendor from the list', async () => {
    const { association, key } = await seedAssociation(t.db);
    const vendor = await seedVendor(t.db, association.id);
    const response = await deleteVendorRoute(request(`/api/vendors/${vendor.id}`, { method: 'DELETE', key }), params(vendor.id));
    expect(response.status).toBe(204);
    expect((await (await listVendorsRoute(request('/api/vendors', { key }))).json()).vendors).toEqual([]);
  });

  it('returns 404 for another association’s vendor, an unknown id or a malformed id', async () => {
    const a = await seedAssociation(t.db);
    const b = await seedAssociation(t.db, { name: 'Oak Hollow Condo Association' });
    const vendor = await seedVendor(t.db, a.association.id);
    for (const id of [vendor.id, '00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      const response = await deleteVendorRoute(request(`/api/vendors/${id}`, { method: 'DELETE', key: b.key }), params(id));
      expect(response.status).toBe(404);
    }
    expect((await (await listVendorsRoute(request('/api/vendors', { key: a.key }))).json()).vendors).toHaveLength(1);
  });

  it('requires the key', async () => {
    const { association } = await seedAssociation(t.db);
    const vendor = await seedVendor(t.db, association.id);
    const response = await deleteVendorRoute(request(`/api/vendors/${vendor.id}`, { method: 'DELETE' }), params(vendor.id));
    expect(response.status).toBe(401);
  });
});

describe('POST /api/vendors/:id/check', () => {
  async function setup(requirements = { ...DEFAULT_REQUIREMENTS, certificateHolder: 'Maple Ridge HOA' }) {
    const { association, key } = await seedAssociation(t.db, { requirements });
    const vendor = await seedVendor(t.db, association.id, { name: 'Acme Landscaping' });
    const check = (body: unknown, as = key) =>
      checkVendorRoute(request(`/api/vendors/${vendor.id}/check`, { method: 'POST', key: as, body }), params(vendor.id));
    return { association, key, vendor, check };
  }

  it('checks the certificate against the vendor’s name and the stored requirements, and saves the result', async () => {
    const { key, check } = await setup();
    const response = await check({ fields: compliantFields(farFuture) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.verdict).toBe('pass');
    expect(body.asOf).toBe(utcToday());
    expect(body.disclaimer).toBe(DISCLAIMER);
    expect(body.results.map((r: { rule: string }) => r.rule)).toEqual(
      expect.arrayContaining(['named_insured', 'certificate_holder', 'workers_comp', 'additional_insured_endorsement']),
    );
    // Workers' comp (2098-06-01) ends before general liability (2099-01-01), and the association requires it.
    expect(body.vendor).toMatchObject({ expiryDate: '2098-06-01', verdict: 'pass', checkedOn: utcToday(), status: 'ok' });

    const [listed] = (await (await listVendorsRoute(request('/api/vendors', { key }))).json()).vendors;
    expect(listed).toMatchObject({ verdict: 'pass', expiryDate: '2098-06-01', checkedOn: utcToday() });
  });

  it('ignores requirements and a vendor name sent by the client', async () => {
    const { check } = await setup();
    const body = await (
      await check({
        fields: compliantFields({ ...farFuture, generalLiability: { ...farFuture.generalLiability, eachOccurrence: 500_000 } }),
        requirements: { ...DEFAULT_REQUIREMENTS, generalLiability: { eachOccurrence: 100_000, aggregate: null } },
        vendorName: 'Somebody Else',
      })
    ).json();
    expect(body.verdict).toBe('fail');
    expect(body.results.find((r: { rule: string }) => r.rule === 'gl_each_occurrence').reason).toContain('below the required $1,000,000');
    expect(body.results.find((r: { rule: string }) => r.rule === 'named_insured').passed).toBe(true);
  });

  it('saves failures with their reasons', async () => {
    const { check, key } = await setup();
    await check({ fields: compliantFields({ ...farFuture, namedInsured: 'Bright Roofing Inc' }) });
    const [listed] = (await (await listVendorsRoute(request('/api/vendors', { key }))).json()).vendors;
    expect(listed.status).toBe('not_compliant');
    expect(listed.failedReasons.join(' ')).toContain('named insured mismatch');
  });

  it('accepts the board’s local date and rejects one far from today', async () => {
    const { check } = await setup();
    const yesterday = addDays(utcToday(), -1);
    expect((await (await check({ fields: compliantFields(farFuture), asOf: yesterday })).json()).asOf).toBe(yesterday);
    const response = await check({ fields: compliantFields(farFuture), asOf: '2020-01-01' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_as_of');
  });

  it('rejects malformed fields', async () => {
    const { check } = await setup();
    const response = await check({ fields: { generalLiability: { expiryDate: '03/01/2027' } } });
    expect(response.status).toBe(400);
    expect((await response.json()).issues.map((i: { path: string }) => i.path)).toContain('fields.generalLiability.expiryDate');
  });

  it('returns 404 for another association’s vendor and 401 without a key', async () => {
    const { check } = await setup();
    const other = await seedAssociation(t.db, { name: 'Oak Hollow Condo Association' });
    expect((await check({ fields: compliantFields() }, other.key)).status).toBe(404);
    expect((await check({ fields: compliantFields() }, '')).status).toBe(401);
    expect(await t.db.query('SELECT 1 FROM checks')).toEqual([]);
  });
});
