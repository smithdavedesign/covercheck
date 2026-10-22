import { describe, expect, it } from 'vitest';
import { check, type CheckResult, type RuleId } from '../lib/check';
import { TODAY, addDays, compliantFields, strictRequirements } from './helpers/fixtures';

const ctx = { vendorName: 'Acme Landscaping', today: TODAY };

function rule(result: CheckResult, id: RuleId, labelIncludes?: string) {
  const found = result.results.find(
    (r) => r.rule === id && (labelIncludes === undefined || r.label.includes(labelIncludes)),
  );
  if (!found) throw new Error(`rule ${id} missing from ${JSON.stringify(result.results.map((r) => r.rule))}`);
  return found;
}

describe('check() baseline', () => {
  it('passes a compliant certificate on every rule', () => {
    const result = check(compliantFields(), strictRequirements(), ctx);
    expect(result.results.filter((r) => !r.passed)).toEqual([]);
    expect(result.verdict).toBe('pass');
    expect(result.warnings).toEqual([]);
    expect(result.asOf).toBe(TODAY);
    expect(result.results.map((r) => r.rule)).toEqual([
      'named_insured',
      'certificate_holder',
      'gl_each_occurrence',
      'gl_aggregate',
      'gl_expiry',
      'workers_comp',
      'additional_insured_endorsement',
      'additional_insured_endorsement',
      'additional_insured_wording',
    ]);
  });

  it('gives every result a label and a one-line reason', () => {
    for (const r of check(compliantFields(), strictRequirements(), ctx).results) {
      expect(r.label.length).toBeGreaterThan(0);
      expect(r.reason.length).toBeGreaterThan(0);
      expect(r.reason).not.toContain('\n');
    }
  });
});

describe('exit criterion 1: general liability each-occurrence limit', () => {
  it('passes 1,000,000 against a 1,000,000 requirement', () => {
    const result = check(
      compliantFields({ generalLiability: { eachOccurrence: 1_000_000 } }),
      strictRequirements({ generalLiability: { eachOccurrence: 1_000_000, aggregate: null } }),
      ctx,
    );
    expect(rule(result, 'gl_each_occurrence').passed).toBe(true);
    expect(result.verdict).toBe('pass');
  });

  it('fails 500,000 with a reason mentioning "limit"', () => {
    const result = check(
      compliantFields({ generalLiability: { eachOccurrence: 500_000 } }),
      strictRequirements({ generalLiability: { eachOccurrence: 1_000_000, aggregate: null } }),
      ctx,
    );
    const r = rule(result, 'gl_each_occurrence');
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('limit');
    expect(r.reason).toContain('$500,000');
    expect(r.reason).toContain('$1,000,000');
    expect(result.verdict).toBe('fail');
  });

  it('fails closed when the limit was not found on the certificate', () => {
    const r = rule(
      check(compliantFields({ generalLiability: { eachOccurrence: null } }), strictRequirements(), ctx),
      'gl_each_occurrence',
    );
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('limit');
    expect(r.reason).toContain('not found');
  });

  it('fails a general aggregate below the requirement', () => {
    const r = rule(
      check(compliantFields({ generalLiability: { aggregate: 1_000_000 } }), strictRequirements(), ctx),
      'gl_aggregate',
    );
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('aggregate limit');
  });

  it('skips limit rules the association did not set', () => {
    const result = check(
      compliantFields(),
      strictRequirements({ generalLiability: { eachOccurrence: null, aggregate: null } }),
      ctx,
    );
    const ids = result.results.map((r) => r.rule);
    expect(ids).not.toContain('gl_each_occurrence');
    expect(ids).not.toContain('gl_aggregate');
  });
});

describe('exit criterion 2: expiry', () => {
  const withExpiry = (expiryDate: string | null) => compliantFields({ generalLiability: { expiryDate } });

  it('fails an expiry date earlier than today with reason "expired"', () => {
    const result = check(withExpiry(addDays(TODAY, -1)), strictRequirements(), ctx);
    const r = rule(result, 'gl_expiry');
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('expired');
    expect(r.reason).toContain(addDays(TODAY, -1));
    expect(result.verdict).toBe('fail');
  });

  it('treats an expiry date of today as expired (coverage ends 12:01 AM)', () => {
    const r = rule(check(withExpiry(TODAY), strictRequirements(), ctx), 'gl_expiry');
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('expired');
  });

  it('passes an expiry within 30 days with warning "expires soon"', () => {
    const expiry = addDays(TODAY, 19);
    const result = check(withExpiry(expiry), strictRequirements(), ctx);
    const r = rule(result, 'gl_expiry');
    expect(r.passed).toBe(true);
    expect(r.warning).toContain('expires soon');
    expect(r.warning).toContain(expiry);
    expect(r.warning).toContain('19 days');
    expect(result.verdict).toBe('pass');
    expect(result.warnings).toEqual([r.warning]);
  });

  it('warns at exactly 30 days and not at 31', () => {
    expect(rule(check(withExpiry(addDays(TODAY, 30)), strictRequirements(), ctx), 'gl_expiry').warning).toContain(
      'expires soon',
    );
    const r31 = rule(check(withExpiry(addDays(TODAY, 31)), strictRequirements(), ctx), 'gl_expiry');
    expect(r31.passed).toBe(true);
    expect(r31.warning).toBeUndefined();
  });

  it('says "1 day" when the policy expires tomorrow', () => {
    expect(rule(check(withExpiry(addDays(TODAY, 1)), strictRequirements(), ctx), 'gl_expiry').warning).toContain(
      'in 1 day)',
    );
  });

  it('honours a custom warning window', () => {
    const r = rule(
      check(withExpiry(addDays(TODAY, 45)), strictRequirements({ expiryWarningDays: 60 }), ctx),
      'gl_expiry',
    );
    expect(r.warning).toContain('expires soon');
  });

  it('fails closed when the expiry date was not found', () => {
    const r = rule(check(withExpiry(null), strictRequirements(), ctx), 'gl_expiry');
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('not found');
  });

  it('fails closed on an expiry date that is not a real date', () => {
    const r = rule(check(withExpiry('2027-02-30x'), strictRequirements(), ctx), 'gl_expiry');
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('not a valid date');
  });

  it('uses the real current date when no "today" is given', () => {
    const fields = compliantFields({ generalLiability: { expiryDate: '2001-01-01' } });
    const result = check(fields, strictRequirements(), { vendorName: 'Acme Landscaping' });
    expect(rule(result, 'gl_expiry').reason).toContain('expired');
    expect(result.asOf).toBe(new Date().toISOString().slice(0, 10));
  });
});

describe('exit criterion 3: named insured', () => {
  const withInsured = (namedInsured: string | null) => compliantFields({ namedInsured });

  it('passes "Acme Landscaping LLC" against vendor "Acme Landscaping"', () => {
    const result = check(withInsured('Acme Landscaping LLC'), strictRequirements(), {
      vendorName: 'Acme Landscaping',
      today: TODAY,
    });
    expect(rule(result, 'named_insured').passed).toBe(true);
    expect(result.verdict).toBe('pass');
  });

  it('fails "Acme Landscaping LLC" against "Bright Roofing" with reason "named insured mismatch"', () => {
    const result = check(withInsured('Acme Landscaping LLC'), strictRequirements(), {
      vendorName: 'Bright Roofing',
      today: TODAY,
    });
    const r = rule(result, 'named_insured');
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('named insured mismatch');
    expect(result.verdict).toBe('fail');
  });

  it.each([
    ['ACME LANDSCAPING, L.L.C.', 'Acme Landscaping Inc.'],
    ['The Acme Landscaping Company', 'acme landscaping'],
    ['Acme Landscaping & Snow LLC', 'Acme Landscaping and Snow'],
    ['Smith Holdings LLC dba Acme Landscaping', 'Acme Landscaping'],
    ['Acme Landscaping LLC', 'Green Thumb d/b/a Acme Landscaping'],
  ])('matches %j to vendor %j', (insured, vendor) => {
    const r = rule(check(withInsured(insured), strictRequirements(), { vendorName: vendor, today: TODAY }), 'named_insured');
    expect(r.passed).toBe(true);
  });

  it.each([
    ['Acme Landscaping Supply LLC', 'Acme Landscaping'],
    ['Acme Roofing LLC', 'Acme Landscaping'],
    ['LLC', 'Acme Landscaping'],
  ])('does not match %j to vendor %j', (insured, vendor) => {
    const r = rule(check(withInsured(insured), strictRequirements(), { vendorName: vendor, today: TODAY }), 'named_insured');
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('named insured mismatch');
  });

  it('fails when the certificate has no named insured', () => {
    const r = rule(check(withInsured(null), strictRequirements(), ctx), 'named_insured');
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('named insured');
  });

  it('fails when no vendor name was given', () => {
    const r = rule(check(compliantFields(), strictRequirements(), { vendorName: '  ', today: TODAY }), 'named_insured');
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('vendor name');
  });
});

describe('exit criterion 4: additional insured endorsement', () => {
  it('fails when required CG 20 10 is absent, with reason "additional insured endorsement missing"', () => {
    const result = check(
      compliantFields({ endorsements: ['CG 20 37'] }),
      strictRequirements({ requiredEndorsements: ['CG 20 10'] }),
      ctx,
    );
    const r = rule(result, 'additional_insured_endorsement', 'CG 20 10');
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('additional insured endorsement missing');
    expect(r.reason).toContain('CG 20 10');
    expect(result.verdict).toBe('fail');
  });

  it('fails when the endorsement list is empty', () => {
    const r = rule(
      check(compliantFields({ endorsements: [] }), strictRequirements({ requiredEndorsements: ['CG 20 10'] }), ctx),
      'additional_insured_endorsement',
    );
    expect(r.passed).toBe(false);
  });

  it.each([['CG 20 10 04 13'], ['CG2010'], ['cg 20 10'], ['CG 20 10 (04/13)'], ['CG-20-10']])(
    'accepts the form written as %j',
    (listed) => {
      const r = rule(
        check(compliantFields({ endorsements: [listed] }), strictRequirements({ requiredEndorsements: ['CG 20 10'] }), ctx),
        'additional_insured_endorsement',
      );
      expect(r.passed).toBe(true);
    },
  );

  it('reports each required form separately', () => {
    const result = check(compliantFields({ endorsements: ['CG 20 10'] }), strictRequirements(), ctx);
    expect(rule(result, 'additional_insured_endorsement', 'CG 20 10').passed).toBe(true);
    expect(rule(result, 'additional_insured_endorsement', 'CG 20 37').passed).toBe(false);
  });

  it('matches non-ISO form names by their text', () => {
    const result = check(
      compliantFields({ endorsements: ['Blanket AI endorsement'] }),
      strictRequirements({ requiredEndorsements: ['blanket ai  endorsement'] }),
      ctx,
    );
    expect(rule(result, 'additional_insured_endorsement').passed).toBe(true);
  });
});

describe('workers comp, certificate holder and additional insured wording', () => {
  it('fails when workers comp is required but missing', () => {
    const r = rule(check(compliantFields({ workersComp: null }), strictRequirements(), ctx), 'workers_comp');
    expect(r.passed).toBe(false);
    expect(r.reason).toContain("workers' comp missing");
  });

  it('treats an all-blank workers comp policy as missing', () => {
    const blank = { carrier: null, policyNumber: null, effectiveDate: null, expiryDate: null };
    const r = rule(check(compliantFields({ workersComp: blank }), strictRequirements(), ctx), 'workers_comp');
    expect(r.reason).toContain("workers' comp missing");
  });

  it('fails an expired workers comp policy', () => {
    const wc = { ...compliantFields().workersComp!, expiryDate: addDays(TODAY, -10) };
    const r = rule(check(compliantFields({ workersComp: wc }), strictRequirements(), ctx), 'workers_comp');
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('expired');
  });

  it('warns when workers comp expires soon', () => {
    const wc = { ...compliantFields().workersComp!, expiryDate: addDays(TODAY, 3) };
    const r = rule(check(compliantFields({ workersComp: wc }), strictRequirements(), ctx), 'workers_comp');
    expect(r.passed).toBe(true);
    expect(r.warning).toContain('expires soon');
  });

  it('skips workers comp when not required', () => {
    const result = check(compliantFields({ workersComp: null }), strictRequirements({ workersCompRequired: false }), ctx);
    expect(result.results.map((r) => r.rule)).not.toContain('workers_comp');
    expect(result.verdict).toBe('pass');
  });

  it('matches the association as certificate holder despite abbreviations and the address block', () => {
    const r = rule(check(compliantFields(), strictRequirements({ certificateHolder: 'Maple Ridge HOA' }), ctx), 'certificate_holder');
    expect(r.passed).toBe(true);
  });

  it('fails when another party is the certificate holder', () => {
    const r = rule(
      check(compliantFields({ certificateHolder: 'Oak Hills Property Management, 9 Oak St' }), strictRequirements(), ctx),
      'certificate_holder',
    );
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('association not named as certificate holder');
  });

  it('fails when the certificate holder box is empty', () => {
    const r = rule(check(compliantFields({ certificateHolder: null }), strictRequirements(), ctx), 'certificate_holder');
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('association not named as certificate holder');
  });

  it('skips the certificate holder rule when no association name is set', () => {
    const result = check(compliantFields(), strictRequirements({ certificateHolder: '' }), ctx);
    expect(result.results.map((r) => r.rule)).not.toContain('certificate_holder');
  });

  it('fails when additional insured wording is required but absent', () => {
    const r = rule(
      check(compliantFields({ description: 'Landscape maintenance.' }), strictRequirements(), ctx),
      'additional_insured_wording',
    );
    expect(r.passed).toBe(false);
    expect(r.reason).toContain('additional insured wording missing');
  });

  it('fails when there is no description at all', () => {
    const r = rule(check(compliantFields({ description: null }), strictRequirements(), ctx), 'additional_insured_wording');
    expect(r.passed).toBe(false);
  });

  it('skips the wording rule when not required', () => {
    const result = check(compliantFields({ description: null }), strictRequirements({ additionalInsuredWording: false }), ctx);
    expect(result.results.map((r) => r.rule)).not.toContain('additional_insured_wording');
  });

  it('fails the overall verdict when any single rule fails and lists every failure', () => {
    const result = check(
      compliantFields({ namedInsured: 'Bright Roofing', endorsements: [] }),
      strictRequirements(),
      ctx,
    );
    expect(result.verdict).toBe('fail');
    expect(result.results.filter((r) => !r.passed).map((r) => r.rule)).toEqual([
      'named_insured',
      'additional_insured_endorsement',
      'additional_insured_endorsement',
    ]);
  });
});
