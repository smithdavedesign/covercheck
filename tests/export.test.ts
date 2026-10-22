import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { GET as exportRoute } from '../app/api/checks/export/route';
import type { RuleResult } from '../lib/check';
import { CHECK_LOG_COLUMNS, checkLogCsv, checkLogFilename, toCsv } from '../lib/csv';
import { setDb } from '../lib/db';
import { addVendor, listChecks, recordCheck, removeVendor } from '../lib/store';
import { csvRecords, parseCsv } from './helpers/csv';
import { seedAssociation, seedVendor, testDb, type TestDb } from './helpers/db';
import { utcToday } from './helpers/fixtures';

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

const BOM = String.fromCharCode(0xfeff);

function get(key?: string | null) {
  const headers: Record<string, string> = {};
  if (key) headers.authorization = `Bearer ${key}`;
  return exportRoute(new Request('http://localhost/api/checks/export', { headers }));
}

const passed = (label: string, reason: string): RuleResult => ({ rule: 'gl_expiry', label, passed: true, reason });
const failed = (rule: RuleResult['rule'], label: string, reason: string): RuleResult => ({ rule, label, passed: false, reason });

const LIMIT = failed(
  'gl_each_occurrence',
  'General liability each occurrence',
  'each-occurrence limit $500,000 is below the required $1,000,000',
);
const ENDORSEMENT = failed(
  'additional_insured_endorsement',
  'Additional insured endorsement CG 20 37',
  'additional insured endorsement missing: CG 20 37 not listed on certificate',
);
const HOLDER = failed(
  'certificate_holder',
  'Certificate holder',
  'association not named as certificate holder: certificate lists "Oak Hollow Condo Association, 9 Oak Lane"',
);
const IN_FORCE = passed('General liability expiry', 'general liability policy in force until 2027-03-01');

describe('exit criterion M3-1: the CSV export has one row per check with vendor, date, verdict and failed rules', () => {
  it('exports every saved check of the board, oldest first, including removed vendors, and nothing of other boards', async () => {
    const { association, key } = await seedAssociation(t.db);
    const acme = await seedVendor(t.db, association.id, { name: 'Acme Landscaping' });
    const bright = await seedVendor(t.db, association.id, { name: 'Bright Roofing' });
    const clearwater = await seedVendor(t.db, association.id, { name: 'Clearwater Pools' });
    await recordCheck(t.db, bright.id, { checkedOn: '2026-09-01', verdict: 'fail', expiryDate: '2027-01-15', results: [IN_FORCE, LIMIT, ENDORSEMENT] });
    await recordCheck(t.db, acme.id, { checkedOn: '2026-09-15', verdict: 'pass', expiryDate: '2027-03-01', results: [IN_FORCE] });
    await recordCheck(t.db, clearwater.id, { checkedOn: '2026-10-01', verdict: 'fail', expiryDate: null, results: [HOLDER] });
    await recordCheck(t.db, bright.id, { checkedOn: '2026-10-20', verdict: 'pass', expiryDate: '2027-06-30', results: [IN_FORCE] });
    // A removed vendor's checks stay in the board's record.
    expect(await removeVendor(t.db, association.id, clearwater.id)).toBe(true);

    const other = await seedAssociation(t.db, { name: 'Oak Hollow Condo Association' });
    const otherVendor = await seedVendor(t.db, other.association.id, { name: 'Zeta Elevators' });
    await recordCheck(t.db, otherVendor.id, { checkedOn: '2026-09-10', verdict: 'fail', expiryDate: '2027-01-01', results: [LIMIT] });

    const response = await get(key);
    expect(response.status).toBe(200);
    const csv = await response.text();
    const [header] = parseCsv(csv);
    expect(header).toEqual(['Date checked', 'Vendor', 'Verdict', 'Failed rules', 'Reasons', 'Certificate expires']);

    const rows = csvRecords(csv);
    expect(rows).toHaveLength(4); // one row per check of this board
    expect(rows).toEqual([
      {
        'Date checked': '2026-09-01',
        Vendor: 'Bright Roofing',
        Verdict: 'Fail',
        'Failed rules': 'General liability each occurrence; Additional insured endorsement CG 20 37',
        Reasons:
          'each-occurrence limit $500,000 is below the required $1,000,000; ' +
          'additional insured endorsement missing: CG 20 37 not listed on certificate',
        'Certificate expires': '2027-01-15',
      },
      {
        'Date checked': '2026-09-15',
        Vendor: 'Acme Landscaping',
        Verdict: 'Pass',
        'Failed rules': '',
        Reasons: '',
        'Certificate expires': '2027-03-01',
      },
      {
        'Date checked': '2026-10-01',
        Vendor: 'Clearwater Pools',
        Verdict: 'Fail',
        'Failed rules': 'Certificate holder',
        Reasons: 'association not named as certificate holder: certificate lists "Oak Hollow Condo Association, 9 Oak Lane"',
        'Certificate expires': '',
      },
      {
        'Date checked': '2026-10-20',
        Vendor: 'Bright Roofing',
        Verdict: 'Pass',
        'Failed rules': '',
        Reasons: '',
        'Certificate expires': '2027-06-30',
      },
    ]);
    expect(csv).not.toContain('Zeta Elevators');
  });

  it('is a CSV download that is never cached', async () => {
    const { key } = await seedAssociation(t.db);
    const response = await get(key);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="covercheck-checks-maple-ridge-hoa-${utcToday()}.csv"`,
    );
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('is just the header row when the board has no checks yet', async () => {
    const { association, key } = await seedAssociation(t.db);
    await seedVendor(t.db, association.id);
    const csv = await (await get(key)).text();
    expect(parseCsv(csv)).toEqual([[...CHECK_LOG_COLUMNS]]);
  });

  it('keeps a vendor name that looks like a formula from running in a spreadsheet', async () => {
    const { association, key } = await seedAssociation(t.db);
    const added = await addVendor(t.db, association.id, {
      name: '=HYPERLINK("http://evil.example","Click")',
      contactEmail: 'x@evil.example',
      agentEmail: null,
    });
    if (!added.ok) throw new Error('vendor not added');
    await recordCheck(t.db, added.vendor.id, { checkedOn: '2026-10-01', verdict: 'pass', expiryDate: '2027-01-01', results: [IN_FORCE] });
    const [row] = csvRecords(await (await get(key)).text());
    expect(row.Vendor).toBe(`'=HYPERLINK("http://evil.example","Click")`);
  });

  it.each([
    ['no key', null],
    ['a malformed key', 'not-a-key'],
    ['an unknown key', 'A'.repeat(43)],
  ])('answers 401 with %s', async (_label, key) => {
    await seedAssociation(t.db);
    const response = await get(key);
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('unauthorized');
  });
});

describe('listChecks', () => {
  it('returns the board’s checks with failed rules only, oldest first', async () => {
    const { association } = await seedAssociation(t.db);
    const vendor = await seedVendor(t.db, association.id, { name: 'Bright Roofing' });
    await recordCheck(t.db, vendor.id, { checkedOn: '2026-10-20', verdict: 'pass', expiryDate: '2027-06-30', results: [IN_FORCE] });
    await recordCheck(t.db, vendor.id, { checkedOn: '2026-09-01', verdict: 'fail', expiryDate: '2027-01-15', results: [IN_FORCE, LIMIT] });
    expect(await listChecks(t.db, association.id)).toEqual([
      {
        checkedOn: '2026-09-01',
        vendorName: 'Bright Roofing',
        verdict: 'fail',
        expiryDate: '2027-01-15',
        failed: [{ label: LIMIT.label, reason: LIMIT.reason }],
      },
      { checkedOn: '2026-10-20', vendorName: 'Bright Roofing', verdict: 'pass', expiryDate: '2027-06-30', failed: [] },
    ]);
  });

  it('orders checks saved on the same date by when they were saved', async () => {
    const { association } = await seedAssociation(t.db);
    const vendor = await seedVendor(t.db, association.id);
    await recordCheck(t.db, vendor.id, { checkedOn: '2026-10-20', verdict: 'fail', expiryDate: '2027-01-15', results: [LIMIT] });
    await recordCheck(t.db, vendor.id, { checkedOn: '2026-10-20', verdict: 'pass', expiryDate: '2027-01-15', results: [IN_FORCE] });
    expect((await listChecks(t.db, association.id)).map((c) => c.verdict)).toEqual(['fail', 'pass']);
  });
});

describe('toCsv', () => {
  it('starts with a UTF-8 BOM, quotes every field and ends each row with CRLF', () => {
    expect(toCsv([['a', 'b'], ['c', null]])).toBe(`${BOM}"a","b"\r\n"c",""\r\n`);
  });

  it('round-trips commas, quotes and line breaks', () => {
    const cells = ['Smith, Jones & Co', 'certificate lists "Maple Ridge"', 'line one\nline two', 'crlf\r\ninside', 'Café Côte HOA'];
    expect(parseCsv(toCsv([cells]))).toEqual([cells]);
  });

  it.each([
    ['=1+1', "'=1+1"],
    ['+1-555-0100', "'+1-555-0100"],
    ['-2+3', "'-2+3"],
    ['@SUM(A1:A2)', "'@SUM(A1:A2)"],
    ['\t=1+1', "'\t=1+1"],
    ['\r=1+1', "'\r=1+1"],
    ['  =1+1', "'  =1+1"],
  ])('prefixes %j so spreadsheets treat it as text', (value, expected) => {
    expect(parseCsv(toCsv([[value]]))).toEqual([[expected]]);
  });

  it.each(['Acme - Landscaping', 'named insured mismatch: certificate is for "=evil"', '2026-10-22', 'a@b.example', ''])(
    'leaves %j as it is',
    (value) => {
      expect(parseCsv(toCsv([[value]]))).toEqual([[value]]);
    },
  );
});

describe('checkLogCsv', () => {
  it('writes the header and one row per entry', () => {
    const csv = checkLogCsv([
      { checkedOn: '2026-09-01', vendorName: 'Bright Roofing', verdict: 'fail', expiryDate: null, failed: [{ label: 'A', reason: 'a' }, { label: 'B', reason: 'b' }] },
    ]);
    expect(parseCsv(csv)).toEqual([[...CHECK_LOG_COLUMNS], ['2026-09-01', 'Bright Roofing', 'Fail', 'A; B', 'a; b', '']]);
  });
});

describe('checkLogFilename', () => {
  it.each([
    ['Maple Ridge HOA', 'covercheck-checks-maple-ridge-hoa-2026-10-22.csv'],
    ['Café Côte Condominium Assn.', 'covercheck-checks-cafe-cote-condominium-assn-2026-10-22.csv'],
    ['  "Oak" / Hollow!! ', 'covercheck-checks-oak-hollow-2026-10-22.csv'],
    ['!!!', 'covercheck-checks-association-2026-10-22.csv'],
    ['The Very Long Name Of A Homeowners Association In Springfield', 'covercheck-checks-the-very-long-name-of-a-homeowners-assoc-2026-10-22.csv'],
  ])('%j → %s', (name, filename) => {
    expect(checkLogFilename(name, '2026-10-22')).toBe(filename);
  });
});
