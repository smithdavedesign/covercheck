import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CoiFields, Requirements } from '../../lib/schema';

/** The fixed "today" the check tests run against. */
export const TODAY = '2026-10-22';

export const ACORD25_TEXT = readFileSync(
  fileURLToPath(new URL('../fixtures/acord25-sample.txt', import.meta.url)),
  'utf8',
);

type FieldsPatch = Partial<Omit<CoiFields, 'generalLiability'>> & {
  generalLiability?: Partial<CoiFields['generalLiability']>;
};

/** A certificate that satisfies every rule in {@link strictRequirements} on {@link TODAY}. */
export function compliantFields(patch: FieldsPatch = {}): CoiFields {
  const base: CoiFields = {
    namedInsured: 'Acme Landscaping LLC',
    certificateHolder: 'Maple Ridge Homeowners Association, 12 Maple Ridge Drive, Springfield, IL 62702',
    generalLiability: {
      carrier: 'Hartford Casualty Insurance Company',
      policyNumber: 'GL-1234567',
      effectiveDate: '2026-03-01',
      expiryDate: '2027-03-01',
      eachOccurrence: 1_000_000,
      aggregate: 2_000_000,
    },
    workersComp: {
      carrier: 'Travelers Indemnity Company',
      policyNumber: 'WC-7654321',
      effectiveDate: '2026-01-01',
      expiryDate: '2027-01-01',
    },
    endorsements: ['CG 20 10', 'CG 20 37'],
    description:
      'Maple Ridge Homeowners Association is included as additional insured per CG 20 10 and CG 20 37.',
  };
  const { generalLiability, ...rest } = patch;
  return { ...base, ...rest, generalLiability: { ...base.generalLiability, ...generalLiability } };
}

/** Requirements with every rule switched on. */
export function strictRequirements(patch: Partial<Requirements> = {}): Requirements {
  return {
    name: 'Maple Ridge requirements',
    certificateHolder: 'Maple Ridge HOA',
    generalLiability: { eachOccurrence: 1_000_000, aggregate: 2_000_000 },
    workersCompRequired: true,
    requiredEndorsements: ['CG 20 10', 'CG 20 37'],
    additionalInsuredWording: true,
    expiryWarningDays: 30,
    ...patch,
  };
}

/** ISO date `days` after `from` (both YYYY-MM-DD). */
export function addDays(from: string, days: number): string {
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Today's date in UTC, as the server sees it. */
export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}
