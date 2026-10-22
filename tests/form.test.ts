import { describe, expect, it } from 'vitest';
import {
  dashboardKeyFromHash,
  fieldsToForm,
  formToFields,
  formToRequirements,
  localIsoDate,
  parseMoney,
  requirementsToForm,
  splitList,
} from '../lib/form';
import { DEFAULT_REQUIREMENTS, emptyFields } from '../lib/schema';
import { compliantFields } from './helpers/fixtures';

describe('dashboardKeyFromHash()', () => {
  const key = 'Ab3_-'.repeat(8) + 'xyz';
  it.each([
    [`#k=${key}`, key],
    [`k=${key}`, key],
    [`#other=1&k=${key}`, key],
    ['#k=', null],
    ['#', null],
    ['', null],
  ])('%s → %s', (hash, expected) => {
    expect(dashboardKeyFromHash(hash)).toBe(expected);
  });
});

describe('parseMoney()', () => {
  it.each([
    ['1,000,000', 1_000_000],
    ['$1,000,000', 1_000_000],
    [' $ 2000000 ', 2_000_000],
    ['1000000.00', 1_000_000],
  ])('reads %j as %d', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it('reads blank as null and garbage as NaN', () => {
    expect(parseMoney('  ')).toBeNull();
    expect(parseMoney('one million')).toBeNaN();
    expect(parseMoney('1,000,000.50')).toBeNaN();
  });
});

describe('splitList()', () => {
  it('splits on commas, semicolons and new lines and drops blanks', () => {
    expect(splitList('CG 20 10, CG 20 37;\nCG 20 26,, ')).toEqual(['CG 20 10', 'CG 20 37', 'CG 20 26']);
  });
});

describe('fields form', () => {
  it('round-trips complete fields', () => {
    expect(formToFields(fieldsToForm(compliantFields()))).toEqual(compliantFields());
  });

  it('round-trips empty fields', () => {
    expect(formToFields(fieldsToForm(emptyFields()))).toEqual(emptyFields());
  });

  it('shows limits with thousands separators', () => {
    expect(fieldsToForm(compliantFields()).glEachOccurrence).toBe('1,000,000');
  });

  it('turns an unreadable limit or date into null so the rule fails closed', () => {
    const form = { ...fieldsToForm(compliantFields()), glEachOccurrence: 'a lot', glExpiry: '2027-02-30' };
    const fields = formToFields(form);
    expect(fields.generalLiability.eachOccurrence).toBeNull();
    expect(fields.generalLiability.expiryDate).toBeNull();
  });

  it('keeps workers comp when only some of its fields are filled', () => {
    const form = { ...fieldsToForm(emptyFields()), wcExpiry: '2027-01-01' };
    expect(formToFields(form).workersComp).toEqual({
      carrier: null,
      policyNumber: null,
      effectiveDate: null,
      expiryDate: '2027-01-01',
    });
  });
});

describe('requirements form', () => {
  it('round-trips the default template', () => {
    const result = formToRequirements(requirementsToForm(DEFAULT_REQUIREMENTS), DEFAULT_REQUIREMENTS);
    expect(result).toEqual({ ok: true, requirements: DEFAULT_REQUIREMENTS });
  });

  it('applies the board’s edits', () => {
    const form = {
      ...requirementsToForm(DEFAULT_REQUIREMENTS),
      certificateHolder: 'Maple Ridge HOA',
      eachOccurrence: '2,000,000',
      aggregate: '',
      workersCompRequired: false,
      requiredEndorsements: 'CG 20 26',
    };
    const result = formToRequirements(form, DEFAULT_REQUIREMENTS);
    expect(result).toEqual({
      ok: true,
      requirements: {
        ...DEFAULT_REQUIREMENTS,
        certificateHolder: 'Maple Ridge HOA',
        generalLiability: { eachOccurrence: 2_000_000, aggregate: null },
        workersCompRequired: false,
        requiredEndorsements: ['CG 20 26'],
      },
    });
  });

  it('refuses a minimum limit that is not a dollar amount instead of silently dropping the rule', () => {
    const form = { ...requirementsToForm(DEFAULT_REQUIREMENTS), eachOccurrence: 'one million' };
    const result = formToRequirements(form, DEFAULT_REQUIREMENTS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/each occurrence/i);
  });
});

describe('localIsoDate()', () => {
  it('formats the local calendar date', () => {
    expect(localIsoDate(new Date(2026, 0, 5, 23, 30))).toBe('2026-01-05');
  });
});
