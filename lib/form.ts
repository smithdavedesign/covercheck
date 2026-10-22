import { z } from 'zod';
import { RequirementsSchema, type CoiFields, type Requirements } from './schema';

/** The confirmation form on the upload page: every certificate field as editable text. */
export interface FieldsForm {
  namedInsured: string;
  certificateHolder: string;
  glCarrier: string;
  glPolicyNumber: string;
  glEffective: string;
  glExpiry: string;
  glEachOccurrence: string;
  glAggregate: string;
  wcCarrier: string;
  wcPolicyNumber: string;
  wcEffective: string;
  wcExpiry: string;
  endorsements: string;
  description: string;
}

export interface RequirementsForm {
  certificateHolder: string;
  eachOccurrence: string;
  aggregate: string;
  workersCompRequired: boolean;
  requiredEndorsements: string;
  additionalInsuredWording: boolean;
}

/** "$1,000,000" → 1000000; blank → null; anything else → NaN. */
export function parseMoney(value: string): number | null {
  const compact = value.replace(/[\s$]/g, '');
  if (!compact) return null;
  const match = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.00?)?$/.exec(compact);
  return match ? Number(match[1].replace(/,/g, '')) : Number.NaN;
}

/** Splits a comma, semicolon or line separated list. */
export function splitList(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** The association key from a dashboard link's fragment (`#k=<key>`); null when there is none. */
export function dashboardKeyFromHash(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get('k') || null;
}

/** The calendar date on the board member's own clock (YYYY-MM-DD). */
export function localIsoDate(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const text = (value: string | null) => value ?? '';
const amount = (value: number | null) => (value === null ? '' : value.toLocaleString('en-US'));
const orNull = (value: string) => value.trim() || null;
const isoDate = z.iso.date();
const dateOrNull = (value: string) => (isoDate.safeParse(value.trim()).success ? value.trim() : null);
/** Unreadable amounts become null, so the limit rule fails closed with "not found". */
const moneyOrNull = (value: string) => {
  const parsed = parseMoney(value);
  return parsed === null || Number.isNaN(parsed) ? null : parsed;
};

export function fieldsToForm(fields: CoiFields): FieldsForm {
  const gl = fields.generalLiability;
  const wc = fields.workersComp;
  return {
    namedInsured: text(fields.namedInsured),
    certificateHolder: text(fields.certificateHolder),
    glCarrier: text(gl.carrier),
    glPolicyNumber: text(gl.policyNumber),
    glEffective: text(gl.effectiveDate),
    glExpiry: text(gl.expiryDate),
    glEachOccurrence: amount(gl.eachOccurrence),
    glAggregate: amount(gl.aggregate),
    wcCarrier: text(wc?.carrier ?? null),
    wcPolicyNumber: text(wc?.policyNumber ?? null),
    wcEffective: text(wc?.effectiveDate ?? null),
    wcExpiry: text(wc?.expiryDate ?? null),
    endorsements: fields.endorsements.join(', '),
    description: text(fields.description),
  };
}

export function formToFields(form: FieldsForm): CoiFields {
  const workersComp = {
    carrier: orNull(form.wcCarrier),
    policyNumber: orNull(form.wcPolicyNumber),
    effectiveDate: dateOrNull(form.wcEffective),
    expiryDate: dateOrNull(form.wcExpiry),
  };
  return {
    namedInsured: orNull(form.namedInsured),
    certificateHolder: orNull(form.certificateHolder),
    generalLiability: {
      carrier: orNull(form.glCarrier),
      policyNumber: orNull(form.glPolicyNumber),
      effectiveDate: dateOrNull(form.glEffective),
      expiryDate: dateOrNull(form.glExpiry),
      eachOccurrence: moneyOrNull(form.glEachOccurrence),
      aggregate: moneyOrNull(form.glAggregate),
    },
    workersComp: Object.values(workersComp).some((value) => value !== null) ? workersComp : null,
    endorsements: splitList(form.endorsements),
    description: orNull(form.description),
  };
}

export function requirementsToForm(requirements: Requirements): RequirementsForm {
  const { eachOccurrence, aggregate } = requirements.generalLiability;
  return {
    certificateHolder: requirements.certificateHolder,
    eachOccurrence: eachOccurrence === null ? '' : String(eachOccurrence),
    aggregate: aggregate === null ? '' : String(aggregate),
    workersCompRequired: requirements.workersCompRequired,
    requiredEndorsements: requirements.requiredEndorsements.join(', '),
    additionalInsuredWording: requirements.additionalInsuredWording,
  };
}

export type RequirementsFormResult = { ok: true; requirements: Requirements } | { ok: false; error: string };

/** Applies the board's edits to `base`. A minimum that isn't a dollar amount is an error, not "no minimum". */
export function formToRequirements(form: RequirementsForm, base: Requirements): RequirementsFormResult {
  const eachOccurrence = parseMoney(form.eachOccurrence);
  const aggregate = parseMoney(form.aggregate);
  if (Number.isNaN(eachOccurrence)) return { ok: false, error: 'Each occurrence minimum must be a dollar amount.' };
  if (Number.isNaN(aggregate)) return { ok: false, error: 'Aggregate minimum must be a dollar amount.' };
  const parsed = RequirementsSchema.safeParse({
    ...base,
    certificateHolder: form.certificateHolder,
    generalLiability: { eachOccurrence, aggregate },
    workersCompRequired: form.workersCompRequired,
    requiredEndorsements: splitList(form.requiredEndorsements),
    additionalInsuredWording: form.additionalInsuredWording,
  });
  return parsed.success
    ? { ok: true, requirements: parsed.data }
    : { ok: false, error: `Requirements are not valid: ${parsed.error.issues[0]?.message ?? 'check the values'}` };
}
