import type { CoiFields, Policy, Requirements } from './schema';

export type RuleId =
  | 'named_insured'
  | 'certificate_holder'
  | 'gl_each_occurrence'
  | 'gl_aggregate'
  | 'gl_expiry'
  | 'workers_comp'
  | 'additional_insured_endorsement'
  | 'additional_insured_wording';

export interface RuleResult {
  rule: RuleId;
  label: string;
  passed: boolean;
  /** One plain-English line explaining the outcome. */
  reason: string;
  /** Set on a passing rule that still needs attention, e.g. "expires soon". */
  warning?: string;
}

export interface CheckResult {
  verdict: 'pass' | 'fail';
  /** The date the certificate was checked against (YYYY-MM-DD). */
  asOf: string;
  results: RuleResult[];
  warnings: string[];
}

export interface CheckContext {
  vendorName: string;
  /** YYYY-MM-DD; defaults to the current UTC date. */
  today?: string;
}

export const DISCLAIMER =
  'A certificate of insurance is not proof of coverage. Ask the vendor’s agent or carrier for confirmation ' +
  'and for copies of the endorsements. covercheck does not give legal or insurance advice.';

/**
 * Checks confirmed certificate fields against an association's requirements.
 * Rules decide; anything missing from the certificate fails its rule.
 */
export function check(fields: CoiFields, requirements: Requirements, context: CheckContext): CheckResult {
  const today = context.today ?? isoToday();
  const warnDays = requirements.expiryWarningDays;
  const gl = fields.generalLiability;
  const results: RuleResult[] = [namedInsuredRule(fields.namedInsured, context.vendorName)];

  if (requirements.certificateHolder) {
    results.push(certificateHolderRule(fields.certificateHolder, requirements.certificateHolder));
  }
  const { eachOccurrence, aggregate } = requirements.generalLiability;
  if (eachOccurrence !== null) {
    results.push(
      limitRule('gl_each_occurrence', 'General liability each occurrence', 'each-occurrence limit', gl.eachOccurrence, eachOccurrence),
    );
  }
  if (aggregate !== null) {
    results.push(limitRule('gl_aggregate', 'General liability aggregate', 'general aggregate limit', gl.aggregate, aggregate));
  }
  results.push(expiryRule('gl_expiry', 'General liability expiry', 'general liability policy', gl.expiryDate, today, warnDays));
  if (requirements.workersCompRequired) results.push(workersCompRule(fields.workersComp, today, warnDays));
  for (const form of requirements.requiredEndorsements) results.push(endorsementRule(form, fields.endorsements));
  if (requirements.additionalInsuredWording) results.push(wordingRule(fields.description));

  return {
    verdict: results.every((r) => r.passed) ? 'pass' : 'fail',
    asOf: today,
    results,
    warnings: results.flatMap((r) => (r.warning ? [r.warning] : [])),
  };
}

// ── Rules ──────────────────────────────────────────────────────────────────────

function namedInsuredRule(namedInsured: string | null, vendorName: string): RuleResult {
  const base = { rule: 'named_insured', label: 'Named insured' } as const;
  if (!vendorName.trim()) return { ...base, passed: false, reason: 'vendor name not provided, so the named insured cannot be checked' };
  if (!namedInsured) return { ...base, passed: false, reason: 'named insured missing from certificate' };
  const insured = businessNames(namedInsured);
  const vendor = businessNames(vendorName);
  const matches = insured.some((a) => vendor.some((b) => a.join(' ') === b.join(' ')));
  return matches
    ? { ...base, passed: true, reason: `named insured "${namedInsured}" matches vendor "${vendorName}"` }
    : {
        ...base,
        passed: false,
        reason: `named insured mismatch: certificate is for "${namedInsured}", vendor is "${vendorName}"`,
      };
}

function certificateHolderRule(holder: string | null, association: string): RuleResult {
  const base = { rule: 'certificate_holder', label: 'Certificate holder' } as const;
  if (!holder) return { ...base, passed: false, reason: 'association not named as certificate holder (holder box is empty)' };
  return containsTokens(nameTokens(holder), nameTokens(association))
    ? { ...base, passed: true, reason: `"${association}" is the certificate holder` }
    : { ...base, passed: false, reason: `association not named as certificate holder: certificate lists "${truncate(holder, 80)}"` };
}

function limitRule(rule: RuleId, label: string, what: string, actual: number | null, required: number): RuleResult {
  if (actual === null) {
    return { rule, label, passed: false, reason: `${what} not found on certificate (required ${money(required)})` };
  }
  return actual >= required
    ? { rule, label, passed: true, reason: `${what} ${money(actual)} meets the required ${money(required)}` }
    : { rule, label, passed: false, reason: `${what} ${money(actual)} is below the required ${money(required)}` };
}

function expiryRule(
  rule: RuleId,
  label: string,
  what: string,
  expiry: string | null,
  today: string,
  warnDays: number,
): RuleResult {
  if (!expiry) return { rule, label, passed: false, reason: `${what} expiry date not found on certificate` };
  const days = daysBetween(today, expiry);
  if (!Number.isFinite(days)) return { rule, label, passed: false, reason: `${what} expiry date "${expiry}" is not a valid date` };
  if (days < 0) return { rule, label, passed: false, reason: `${what} expired on ${expiry}` };
  if (days === 0) {
    // Policies run to 12:01 AM on the expiration date, so that whole day is uncovered.
    return { rule, label, passed: false, reason: `${what} expired today (${expiry}); coverage ends at 12:01 AM on the expiration date` };
  }
  const result: RuleResult = { rule, label, passed: true, reason: `${what} in force until ${expiry}` };
  if (days <= warnDays) {
    result.warning = `expires soon: ${what} ends ${expiry} (in ${days} day${days === 1 ? '' : 's'})`;
  }
  return result;
}

function workersCompRule(policy: Policy | null, today: string, warnDays: number): RuleResult {
  if (!policy || (!policy.policyNumber && !policy.expiryDate && !policy.carrier)) {
    return {
      rule: 'workers_comp',
      label: "Workers' compensation",
      passed: false,
      reason: "workers' comp missing: no workers' compensation policy on certificate",
    };
  }
  return expiryRule('workers_comp', "Workers' compensation", "workers' comp policy", policy.expiryDate, today, warnDays);
}

function endorsementRule(required: string, listed: string[]): RuleResult {
  const key = endorsementKey(required);
  const display = formNumber(required) ?? required.trim();
  const base = { rule: 'additional_insured_endorsement', label: `Additional insured endorsement ${display}` } as const;
  return listed.some((form) => endorsementKey(form) === key)
    ? { ...base, passed: true, reason: `${display} listed on certificate` }
    : { ...base, passed: false, reason: `additional insured endorsement missing: ${display} not listed on certificate` };
}

function wordingRule(description: string | null): RuleResult {
  const base = { rule: 'additional_insured_wording', label: 'Additional insured wording' } as const;
  return description && /\badditional(?:ly)?\s+insured\b/i.test(description)
    ? { ...base, passed: true, reason: 'description of operations includes additional insured wording' }
    : { ...base, passed: false, reason: 'additional insured wording missing from description of operations' };
}

// ── Names ──────────────────────────────────────────────────────────────────────

const ABBREVIATIONS: Record<string, string> = {
  hoa: 'homeowners association',
  poa: 'property owners association',
  coa: 'condominium owners association',
  assn: 'association',
  assoc: 'association',
  condo: 'condominium',
  homeowner: 'homeowners',
};
const ENTITY_SUFFIXES = new Set([
  'llc', 'lc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'ltd', 'limited', 'lp', 'llp', 'pllc', 'pc', 'plc',
]);
const TRADE_NAME_SEPARATOR = /\s(?:d\/b\/a|dba|a\/k\/a|aka)\s/i;

/** Lower-case word tokens with punctuation, abbreviations and legal-entity suffixes normalised away. */
function nameTokens(name: string): string[] {
  const tokens = name
    .toLowerCase()
    .replace(/['’.]/g, '')
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .flatMap((token) => (ABBREVIATIONS[token] ?? token).split(' '));
  const merged: string[] = [];
  for (const token of tokens) {
    if (merged.at(-1) === 'home' && (token === 'owners' || token === 'owner')) merged[merged.length - 1] = 'homeowners';
    else merged.push(token);
  }
  while (merged.length > 1 && ENTITY_SUFFIXES.has(merged.at(-1)!)) merged.pop();
  if (merged.length > 1 && merged[0] === 'the') merged.shift();
  return merged;
}

/** Every name a business goes by: its legal name and any "dba" trade names. */
function businessNames(name: string): string[][] {
  return name
    .split(TRADE_NAME_SEPARATOR)
    .map(nameTokens)
    .filter((tokens) => tokens.length > 0);
}

function containsTokens(haystack: string[], needle: string[]): boolean {
  if (needle.length === 0) return false;
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((token, j) => haystack[i + j] === token)) return true;
  }
  return false;
}

// ── Endorsement form numbers ────────────────────────────────────────────────────

/** "CG2010", "cg 20 10 04 13", "CG-20-10" → "CG 20 10"; null when it is not an ISO-style form number. */
export function formNumber(value: string): string | null {
  const match = /^\s*([a-z]{2})[\s-]*(\d{2})[\s-]*(\d{2})(?!\d)/i.exec(value);
  return match ? `${match[1].toUpperCase()} ${match[2]} ${match[3]}` : null;
}

function endorsementKey(value: string): string {
  return formNumber(value) ?? value.trim().toUpperCase().replace(/\s+/g, ' ');
}

// ── Dates and formatting ────────────────────────────────────────────────────────

/** Today's date in UTC as YYYY-MM-DD. */
export function isoToday(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

function money(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
