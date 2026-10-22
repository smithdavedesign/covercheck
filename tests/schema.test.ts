import { describe, expect, it } from 'vitest';
import template from '../config/default-requirements.json';
import { CoiFieldsSchema, DEFAULT_REQUIREMENTS, RequirementsSchema, emptyFields } from '../lib/schema';
import { compliantFields } from './helpers/fixtures';

describe('default association template (config/default-requirements.json)', () => {
  it('is valid against the requirements schema', () => {
    expect(RequirementsSchema.safeParse(template).success).toBe(true);
  });

  it('requires $1,000,000 each occurrence, $2,000,000 aggregate, workers comp and both AI endorsements', () => {
    expect(DEFAULT_REQUIREMENTS.generalLiability).toEqual({ eachOccurrence: 1_000_000, aggregate: 2_000_000 });
    expect(DEFAULT_REQUIREMENTS.workersCompRequired).toBe(true);
    expect(DEFAULT_REQUIREMENTS.requiredEndorsements).toEqual(['CG 20 10', 'CG 20 37']);
    expect(DEFAULT_REQUIREMENTS.additionalInsuredWording).toBe(true);
    expect(DEFAULT_REQUIREMENTS.expiryWarningDays).toBe(30);
  });

  it('leaves the association name for the board to fill in', () => {
    expect(DEFAULT_REQUIREMENTS.certificateHolder).toBe('');
  });

  it('fills defaults for a sparse requirements config', () => {
    expect(RequirementsSchema.parse({ generalLiability: { eachOccurrence: 500_000 } })).toEqual({
      name: 'Association requirements',
      certificateHolder: '',
      generalLiability: { eachOccurrence: 500_000, aggregate: null },
      workersCompRequired: false,
      requiredEndorsements: [],
      additionalInsuredWording: false,
      expiryWarningDays: 30,
    });
  });

  it('rejects negative limits and absurd warning windows', () => {
    expect(RequirementsSchema.safeParse({ generalLiability: { eachOccurrence: -1 } }).success).toBe(false);
    expect(RequirementsSchema.safeParse({ expiryWarningDays: 9999 }).success).toBe(false);
  });
});

describe('COI field schema', () => {
  it('accepts a complete set of fields unchanged', () => {
    expect(CoiFieldsSchema.parse(compliantFields())).toEqual(compliantFields());
  });

  it('fills nulls for fields the client left out', () => {
    expect(CoiFieldsSchema.parse({})).toEqual(emptyFields());
  });

  it('rejects impossible dates and non-numeric limits', () => {
    const bad = CoiFieldsSchema.safeParse({ generalLiability: { expiryDate: '2027-02-30', eachOccurrence: 'lots' } });
    expect(bad.success).toBe(false);
  });

  it('caps list and string sizes', () => {
    expect(CoiFieldsSchema.safeParse({ endorsements: Array(51).fill('CG 20 10') }).success).toBe(false);
    expect(CoiFieldsSchema.safeParse({ namedInsured: 'x'.repeat(301) }).success).toBe(false);
  });
});
