import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as checkRoute } from '../app/api/check/route';
import { POST as extractRoute } from '../app/api/extract/route';
import { GET as usageRoute } from '../app/api/usage/route';
import { POST as vendorCheckRoute } from '../app/api/vendors/[id]/check/route';
import { setDb, type Db } from '../lib/db';
import { MAX_PDF_BYTES } from '../lib/schema';
import { USAGE_KINDS, USAGE_TIMEOUT_MS, recordUsage, trackUsage, usageCounts, type UsageKind } from '../lib/usage';
import usageFixture from './fixtures/usage-events.json';
import { seedAssociation, seedVendor, testDb, type TestDb } from './helpers/db';
import { ACORD25_TEXT, TODAY, compliantFields, utcToday } from './helpers/fixtures';
import { layoutTextToPdf, makePdf } from './helpers/pdf';

let t: TestDb;
/** A throwaway value built at runtime; the real secret only ever lives in the Vercel env. */
const secret = ['stats', 'test', 'R5t8Y1u3'.repeat(4)].join('-');

beforeAll(async () => {
  t = await testDb();
});
afterAll(async () => {
  setDb(null);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  setDb(t.db);
  vi.stubEnv('STATS_SECRET', secret);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function getUsage(authorization?: string) {
  const headers: Record<string, string> = {};
  if (authorization !== undefined) headers.authorization = authorization;
  return usageRoute(new Request('http://localhost/api/usage', { headers }));
}

function upload(bytes: Uint8Array, type = 'application/pdf') {
  const form = new FormData();
  form.append('file', new File([bytes.slice().buffer], 'coi.pdf', { type }));
  return extractRoute(new Request('http://localhost/api/extract', { method: 'POST', body: form }));
}

function postCheck(body: unknown) {
  return checkRoute(
    new Request('http://localhost/api/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  );
}

const counts = () => usageCounts(t.db);
const farFuture = {
  generalLiability: { expiryDate: '2099-01-01' },
  workersComp: { carrier: 'Travelers Indemnity Company', policyNumber: 'WC-7654321', effectiveDate: '2026-01-01', expiryDate: '2098-06-01' },
};

describe('exit criterion M3-2: the counts endpoint returns the number of uploads recorded in a test fixture', () => {
  const events = usageFixture.events as { day: string; kind: UsageKind }[];

  it('returns the fixture’s uploads, passes and fails, in total and per day', async () => {
    for (const event of events) await recordUsage(t.db, event.kind, event.day);

    const response = await getUsage(`Bearer ${secret}`);
    expect(response.status).toBe(200);
    const body = await response.json();
    const fixtureUploads = events.filter((event) => event.kind === 'upload').length;
    expect(fixtureUploads).toBe(7);
    expect(body.uploads).toBe(fixtureUploads);
    expect(body).toEqual({
      uploads: 7,
      passes: 4,
      fails: 3,
      days: [
        { date: '2026-10-19', uploads: 2, passes: 1, fails: 1 },
        { date: '2026-10-20', uploads: 3, passes: 2, fails: 1 },
        { date: '2026-10-22', uploads: 2, passes: 1, fails: 1 },
      ],
    });
  });

  it('counts certificates uploaded through POST /api/extract', async () => {
    for (let i = 0; i < 3; i++) expect((await upload(layoutTextToPdf(ACORD25_TEXT))).status).toBe(200);
    const body = await (await getUsage(`Bearer ${secret}`)).json();
    expect(body).toMatchObject({ uploads: 3, passes: 0, fails: 0 });
    expect(body.days).toEqual([{ date: utcToday(), uploads: 3, passes: 0, fails: 0 }]);
  });
});

describe('GET /api/usage', () => {
  it('is never cached', async () => {
    const response = await getUsage(`Bearer ${secret}`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ uploads: 0, passes: 0, fails: 0, days: [] });
  });

  it.each([
    ['no authorization', undefined],
    ['a wrong secret', `Bearer ${secret}x`],
    ['the secret without "Bearer"', secret],
    ['an empty bearer', 'Bearer '],
  ])('answers 401 with %s', async (_label, authorization) => {
    const response = await getUsage(authorization);
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('unauthorized');
  });

  it('fails closed with 503 when STATS_SECRET is not set, even for "Bearer undefined"', async () => {
    vi.stubEnv('STATS_SECRET', '');
    for (const authorization of ['Bearer undefined', 'Bearer ', undefined]) {
      const response = await getUsage(authorization);
      expect(response.status).toBe(503);
      expect((await response.json()).error).toBe('stats_not_configured');
    }
  });
});

describe('usage counters', () => {
  it('starts at zero', async () => {
    expect(await counts()).toEqual({ uploads: 0, passes: 0, fails: 0, days: [] });
  });

  it('counts concurrent events exactly', async () => {
    await Promise.all(Array.from({ length: 25 }, () => recordUsage(t.db, 'upload', TODAY)));
    await Promise.all(Array.from({ length: 5 }, () => recordUsage(t.db, 'fail', TODAY)));
    expect(await counts()).toEqual({ uploads: 25, passes: 0, fails: 5, days: [{ date: TODAY, uploads: 25, passes: 0, fails: 5 }] });
  });

  it('keeps one row per day and kind', async () => {
    for (const kind of USAGE_KINDS) for (let i = 0; i < 3; i++) await recordUsage(t.db, kind, TODAY);
    expect(await t.db.query('SELECT 1 FROM usage_counts')).toHaveLength(USAGE_KINDS.length);
  });

  it('rejects an unknown kind at the database', async () => {
    await expect(recordUsage(t.db, 'download' as unknown as UsageKind, TODAY)).rejects.toThrow();
  });

  it('never fails the request it is counting when the database is down', async () => {
    const broken: Db = {
      query: async () => {
        throw new Error('connection refused to the database host');
      },
      transaction: async () => {
        throw new Error('connection refused to the database host');
      },
    };
    setDb(broken);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(trackUsage('upload')).resolves.toBeUndefined();
    const response = await postCheck({ vendorName: 'Acme Landscaping', fields: compliantFields(farFuture) });
    expect(response.status).toBe(200);
    expect(log).toHaveBeenCalledWith('covercheck: usage not recorded', { kind: 'pass', error: 'Error' });
    // Only the error's name is logged, never its message (which can carry hostnames).
    expect(JSON.stringify(log.mock.calls)).not.toContain('connection refused');
  });

  it('delays an upload or check by at most USAGE_TIMEOUT_MS when the database hangs', async () => {
    const hung: Db = { query: () => new Promise(() => {}), transaction: () => new Promise(() => {}) };
    setDb(hung);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();
    try {
      let answered = false;
      const response = postCheck({ vendorName: 'Acme Landscaping', fields: compliantFields(farFuture) }).then((r) => {
        answered = true;
        return r;
      });
      await vi.advanceTimersByTimeAsync(USAGE_TIMEOUT_MS - 1);
      expect(answered).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect((await response).status).toBe(200);
      expect(log).toHaveBeenCalledWith('covercheck: usage not recorded', { kind: 'pass', error: 'TimeoutError' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not wait for the timeout when the count is quick', async () => {
    const started = performance.now();
    await trackUsage('upload');
    expect(performance.now() - started).toBeLessThan(USAGE_TIMEOUT_MS);
    expect((await counts()).uploads).toBe(1);
  });
});

describe('what counts as an upload (POST /api/extract)', () => {
  it.each([
    ['a readable certificate', () => layoutTextToPdf(ACORD25_TEXT), 200],
    ['a scan with no text', () => makePdf([{ drawing: '0.5 g 20 20 300 300 re f' }]), 422],
    ['a damaged PDF', () => new TextEncoder().encode('%PDF-1.7\nbroken\n%%EOF'), 422],
    ['a file that is not a PDF', () => new TextEncoder().encode('GIF89a...'), 415],
  ])('counts %s', async (_label, bytes, status) => {
    expect((await upload(bytes())).status).toBe(status);
    expect((await counts()).uploads).toBe(1);
  });

  it('does not count a request without a file', async () => {
    const form = new FormData();
    form.append('note', 'no file here');
    const response = await extractRoute(new Request('http://localhost/api/extract', { method: 'POST', body: form }));
    expect(response.status).toBe(400);
    expect((await counts()).uploads).toBe(0);
  });

  it('does not count a file over the size limit', async () => {
    const big = new Uint8Array(MAX_PDF_BYTES + 1);
    big.set(new TextEncoder().encode('%PDF-1.7\n'));
    expect((await upload(big)).status).toBe(413);
    expect((await counts()).uploads).toBe(0);
  });
});

describe('what counts as a pass or a fail', () => {
  it('counts each verdict from POST /api/check', async () => {
    await postCheck({ vendorName: 'Acme Landscaping', fields: compliantFields(farFuture) });
    await postCheck({ vendorName: 'Bright Roofing', fields: compliantFields(farFuture) });
    await postCheck({ vendorName: 'Bright Roofing', fields: compliantFields(farFuture) });
    expect(await counts()).toMatchObject({ uploads: 0, passes: 1, fails: 2 });
  });

  it('does not count a rejected check request', async () => {
    expect((await postCheck({ fields: compliantFields() })).status).toBe(400);
    expect(await counts()).toMatchObject({ passes: 0, fails: 0 });
  });

  it('counts each verdict saved to a dashboard vendor, and nothing for a 404 or a 400', async () => {
    const { association, key } = await seedAssociation(t.db);
    const vendor = await seedVendor(t.db, association.id, { name: 'Acme Landscaping' });
    const other = await seedAssociation(t.db, { name: 'Oak Hollow Condo Association' });
    const save = (body: unknown, as = key) =>
      vendorCheckRoute(
        new Request(`http://localhost/api/vendors/${vendor.id}/check`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${as}` },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: vendor.id }) },
      );

    expect((await save({ fields: compliantFields(farFuture) })).status).toBe(200);
    expect((await save({ fields: compliantFields({ ...farFuture, namedInsured: 'Bright Roofing Inc' }) })).status).toBe(200);
    expect((await save({ fields: compliantFields(farFuture) }, other.key)).status).toBe(404);
    expect((await save({ fields: { generalLiability: { expiryDate: '03/01/2027' } } })).status).toBe(400);
    expect(await counts()).toMatchObject({ passes: 1, fails: 1 });
  });
});
