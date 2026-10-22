import { describe, expect, it } from 'vitest';
import { check } from '../lib/check';
import { extractFields, toIsoDate } from '../lib/extract';
import { CoiFieldsSchema, DEFAULT_REQUIREMENTS } from '../lib/schema';
import { ACORD25_TEXT, TODAY } from './helpers/fixtures';

describe('exit criterion 5: extraction from a sample ACORD 25', () => {
  const fields = extractFields(ACORD25_TEXT);

  it('returns the general liability policy end date from the fixture', () => {
    expect(fields.generalLiability.expiryDate).toBe('2027-03-01');
  });

  it('returns the each-occurrence limit from the fixture', () => {
    expect(fields.generalLiability.eachOccurrence).toBe(1_000_000);
  });

  it('returns the rest of the general liability row', () => {
    expect(fields.generalLiability).toEqual({
      carrier: 'Hartford Casualty Insurance Company',
      policyNumber: 'GL-1234567',
      effectiveDate: '2026-03-01',
      expiryDate: '2027-03-01',
      eachOccurrence: 1_000_000,
      aggregate: 2_000_000,
    });
  });

  it('returns the named insured without the address', () => {
    expect(fields.namedInsured).toBe('Acme Landscaping LLC');
  });

  it('returns the workers comp policy with its own carrier and dates', () => {
    expect(fields.workersComp).toEqual({
      carrier: 'Travelers Indemnity Company',
      policyNumber: 'WC-7654321',
      effectiveDate: '2026-01-01',
      expiryDate: '2027-01-01',
    });
  });

  it('returns endorsement form numbers without edition dates, once each', () => {
    expect(fields.endorsements).toEqual(['CG 20 10', 'CG 20 37']);
  });

  it('returns the certificate holder block without the cancellation column', () => {
    expect(fields.certificateHolder).toBe(
      'Maple Ridge Homeowners Association, Inc., c/o Board Treasurer, 12 Maple Ridge Drive, Springfield, IL 62702',
    );
  });

  it('returns the description of operations without its label', () => {
    expect(fields.description).toMatch(/^Landscape maintenance of Maple Ridge common areas\./);
    expect(fields.description).toContain('included as additional insured');
    expect(fields.description).toMatch(/written contract\.$/);
  });

  it('feeds check() end to end: the sample passes the default template for its association', () => {
    const result = check(
      fields,
      { ...DEFAULT_REQUIREMENTS, certificateHolder: 'Maple Ridge HOA' },
      { vendorName: 'Acme Landscaping', today: TODAY },
    );
    expect(result.results.filter((r) => !r.passed)).toEqual([]);
    expect(result.verdict).toBe('pass');
  });
});

describe('extractFields() on incomplete text', () => {
  it('returns nulls, never guesses, for empty text', () => {
    expect(extractFields('')).toEqual({
      namedInsured: null,
      certificateHolder: null,
      generalLiability: {
        carrier: null,
        policyNumber: null,
        effectiveDate: null,
        expiryDate: null,
        eachOccurrence: null,
        aggregate: null,
      },
      workersComp: null,
      endorsements: [],
      description: null,
    });
  });

  it('leaves workers comp null when its row is printed but empty', () => {
    const text = ACORD25_TEXT.replace('WC-7654321   01/01/2026   01/01/2027', '');
    expect(extractFields(text).workersComp).toBeNull();
  });

  it('does not take the umbrella limit when the general liability limit is blank', () => {
    const text = ACORD25_TEXT.replace('EACH OCCURRENCE   $   1,000,000', 'EACH OCCURRENCE   $').replace(
      'UMBRELLA LIAB   OCCUR                                          EACH OCCURRENCE   $',
      'UMBRELLA LIAB   OCCUR                                          EACH OCCURRENCE   $   5,000,000',
    );
    expect(text).toContain('EACH OCCURRENCE   $   5,000,000');
    expect(extractFields(text).generalLiability.eachOccurrence).toBeNull();
  });

  it('reads a name that shares its cell with the INSURED label', () => {
    const text = ACORD25_TEXT.replace(
      'INSURED                                      INSURER B',
      'INSURED Bright Roofing Inc                   INSURER B',
    );
    expect(extractFields(text).namedInsured).toBe('Bright Roofing Inc');
  });

  it('falls back to the only listed insurer when the row has no insurer letter', () => {
    const text = [
      'INSURER A :   Zenith Insurance Company   13269',
      'X   COMMERCIAL GENERAL LIABILITY   GL 99 1   05/01/26   05/01/27   EACH OCCURRENCE   $1,000,000',
    ].join('\n');
    const gl = extractFields(text).generalLiability;
    expect(gl.carrier).toBe('Zenith Insurance Company');
    expect(gl.policyNumber).toBe('GL 99 1');
    expect(gl.effectiveDate).toBe('2026-05-01');
    expect(gl.expiryDate).toBe('2027-05-01');
    expect(gl.eachOccurrence).toBe(1_000_000);
  });

  it('reads a policy number and dates that share one cell', () => {
    const text = 'A   COMMERCIAL GENERAL LIABILITY   GL-55 06/01/2026 06/01/2027';
    const gl = extractFields(text).generalLiability;
    expect(gl.policyNumber).toBe('GL-55');
    expect(gl.expiryDate).toBe('2027-06-01');
  });

  it('ignores a date pair whose expiry is not after its effective date', () => {
    const text = 'A   COMMERCIAL GENERAL LIABILITY   GL-55   06/01/2027   06/01/2026';
    expect(extractFields(text).generalLiability.expiryDate).toBeNull();
  });

  it('always returns fields the check API accepts, even from oversized text', () => {
    expect(CoiFieldsSchema.safeParse(extractFields(ACORD25_TEXT)).success).toBe(true);
    const manyForms = Array.from({ length: 80 }, (_, i) => `CG ${String(10 + (i % 90)).padStart(2, '0')} ${String(i).padStart(2, '0')}`);
    const text = [
      'INSURED',
      `Acme ${'Landscaping '.repeat(60)}LLC`,
      'DESCRIPTION OF OPERATIONS',
      ...Array.from({ length: 5 }, () => 'additional insured '.repeat(80)),
      'CERTIFICATE HOLDER',
      'Maple Ridge HOA',
      manyForms.join(' and '),
    ].join('\n');
    const fields = extractFields(text);
    expect(fields.endorsements).toHaveLength(50);
    expect(CoiFieldsSchema.safeParse(fields).success).toBe(true);
  });

  it('does not read ZIP codes or policy numbers as endorsement forms', () => {
    expect(extractFields('Springfield, IL 62701\nSacramento, CA 95814\nWC 1234\nCG 20 26 04 13').endorsements).toEqual([
      'CG 20 26',
    ]);
  });
});

describe('toIsoDate()', () => {
  it.each([
    ['03/01/2027', '2027-03-01'],
    ['3/1/2027', '2027-03-01'],
    ['03/01/27', '2027-03-01'],
    ['12/31/1999', '1999-12-31'],
  ])('converts %s to %s', (input, expected) => {
    expect(toIsoDate(input)).toBe(expected);
  });

  it.each([['02/30/2027'], ['13/01/2027'], ['00/10/2027'], ['nonsense']])('rejects %s', (input) => {
    expect(toIsoDate(input)).toBeNull();
  });
});
