import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POST } from '../app/api/check/route';
import { DISCLAIMER } from '../lib/check';
import { setDb } from '../lib/db';
import { DEFAULT_REQUIREMENTS } from '../lib/schema';
import { testDb, type TestDb } from './helpers/db';
import { addDays, compliantFields, strictRequirements, utcToday } from './helpers/fixtures';

// Verdicts are counted (M3); an in-memory database keeps the count out of the local dev database.
let t: TestDb;
beforeAll(async () => {
  t = await testDb();
  setDb(t.db);
});
afterAll(async () => {
  setDb(null);
  await t.close();
});

function post(body: unknown, raw?: string) {
  return POST(
    new Request('http://localhost/api/check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw ?? JSON.stringify(body),
    }),
  );
}

const farFuture = { generalLiability: { expiryDate: '2099-01-01' } };

describe('POST /api/check', () => {
  it('returns the verdict, one result per rule and the disclaimer', async () => {
    const response = await post({
      vendorName: 'Acme Landscaping',
      fields: compliantFields(farFuture),
      requirements: strictRequirements({ workersCompRequired: false }),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.verdict).toBe('pass');
    expect(body.asOf).toBe(utcToday());
    expect(body.results.map((r: { rule: string }) => r.rule)).toContain('gl_each_occurrence');
    expect(body.disclaimer).toBe(DISCLAIMER);
    expect(body.disclaimer).toContain('not proof of coverage');
  });

  it('returns per-rule failures with reasons', async () => {
    const response = await post({
      vendorName: 'Bright Roofing',
      fields: compliantFields({ ...farFuture, generalLiability: { ...farFuture.generalLiability, eachOccurrence: 500_000 } }),
      requirements: strictRequirements(),
    });
    const body = await response.json();
    expect(body.verdict).toBe('fail');
    const failed = body.results.filter((r: { passed: boolean }) => !r.passed);
    expect(failed.map((r: { reason: string }) => r.reason).join(' | ')).toMatch(/named insured mismatch.*limit/);
  });

  it('uses the default association template when no requirements are sent', async () => {
    const response = await post({ vendorName: 'Acme Landscaping', fields: compliantFields(farFuture) });
    expect(response.status).toBe(200);
    const body = await response.json();
    const ids = body.results.map((r: { rule: string }) => r.rule);
    expect(ids).toContain('workers_comp');
    expect(ids.filter((id: string) => id === 'additional_insured_endorsement')).toHaveLength(
      DEFAULT_REQUIREMENTS.requiredEndorsements.length,
    );
  });

  it('accepts the board’s local date as asOf when it is within a day of the server date', async () => {
    const asOf = addDays(utcToday(), -1);
    const body = await (await post({ vendorName: 'Acme Landscaping', fields: compliantFields(farFuture), asOf })).json();
    expect(body.asOf).toBe(asOf);
  });

  it('rejects an asOf date far from today', async () => {
    const response = await post({ vendorName: 'Acme Landscaping', fields: compliantFields(), asOf: '2020-01-01' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_as_of');
  });

  it('rejects a body that is not JSON', async () => {
    const response = await post(undefined, 'not json');
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe('invalid_json');
  });

  it('rejects malformed fields with the offending paths', async () => {
    const response = await post({
      vendorName: 'Acme Landscaping',
      fields: { ...compliantFields(), generalLiability: { eachOccurrence: '1,000,000', expiryDate: '03/01/2027' } },
    });
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('invalid_request');
    const paths = body.issues.map((i: { path: string }) => i.path);
    expect(paths).toContain('fields.generalLiability.eachOccurrence');
    expect(paths).toContain('fields.generalLiability.expiryDate');
  });

  it('rejects a missing vendor name', async () => {
    const response = await post({ fields: compliantFields() });
    expect(response.status).toBe(400);
    expect((await response.json()).issues.map((i: { path: string }) => i.path)).toContain('vendorName');
  });

  it('rejects oversized bodies', async () => {
    const response = await post({ vendorName: 'Acme', fields: compliantFields({ description: 'x'.repeat(200_000) }) });
    expect(response.status).toBe(413);
  });
});
