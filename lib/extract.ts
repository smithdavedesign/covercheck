import { formNumber } from './check';
import { FIELD_LIMITS, emptyFields, type CoiFields, type Policy } from './schema';

/**
 * Turns the text of an ACORD 25 certificate into the field schema.
 *
 * Input is layout text as produced by `pdfToText`: one line per printed line, columns
 * separated by three or more spaces. Parsing is anchored on the form's printed labels
 * and section headings. When a value can't be located confidently it stays `null`;
 * the board confirms every field before the check runs.
 */
export function extractFields(text: string): CoiFields {
  const fields = emptyFields();
  const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+$/, ''));
  if (!lines.some((line) => line.trim())) return fields;

  const insurers = insurerNames(lines);
  const glStart = findLine(lines, /COMMERCIAL GENERAL LIABILITY/);
  if (glStart >= 0) {
    // The limits column can sit a line above the coverage name, so start one line early.
    // The line above is the table header, which carries no values.
    const gl = section(lines, Math.max(0, glStart - 1), glStart + 1, GL_SECTION_END);
    const policy = policyRow(gl, insurers);
    fields.generalLiability = {
      ...policy,
      eachOccurrence: moneyAfter(gl, /EACH OCCURRENCE/),
      aggregate: moneyAfter(gl, /GENERAL AGGREGATE/),
    };
  }

  const wcStart = findLine(lines, /WORKERS COMPENSATION/);
  if (wcStart >= 0) {
    const policy = policyRow(section(lines, wcStart, wcStart + 1, /^DESCRIPTION OF OPERATIONS/), insurers);
    fields.workersComp = policy.expiryDate ? policy : null;
  }

  fields.namedInsured = namedInsured(lines);
  fields.certificateHolder = certificateHolder(lines);
  fields.description = description(lines);
  fields.endorsements = endorsementForms(text);
  return withinLimits(fields);
}

/** PDF text is untrusted: cap every value to the API schema's limits so a confirmed form always validates. */
function withinLimits(fields: CoiFields): CoiFields {
  const cap = (value: string | null, max: number) => (value === null ? null : value.slice(0, max).trim());
  const capPolicy = <P extends Policy>(policy: P): P => ({
    ...policy,
    carrier: cap(policy.carrier, FIELD_LIMITS.carrier),
    policyNumber: cap(policy.policyNumber, FIELD_LIMITS.policyNumber),
  });
  return {
    namedInsured: cap(fields.namedInsured, FIELD_LIMITS.namedInsured),
    certificateHolder: cap(fields.certificateHolder, FIELD_LIMITS.certificateHolder),
    generalLiability: capPolicy(fields.generalLiability),
    workersComp: fields.workersComp && capPolicy(fields.workersComp),
    endorsements: fields.endorsements.slice(0, FIELD_LIMITS.endorsements),
    description: cap(fields.description, FIELD_LIMITS.description),
  };
}

const CELL_SEPARATOR = /\s{3,}|\t+/;
const GL_SECTION_END = /AUTOMOBILE LIABILITY|UMBRELLA LIAB|EXCESS LIAB|WORKERS COMPENSATION|^DESCRIPTION OF OPERATIONS/;
const DATE = String.raw`\d{1,2}/\d{1,2}/\d{2,4}`;
const DATE_PAIR = new RegExp(String.raw`(${DATE})\s+(${DATE})`);
const POLICY_NUMBER = /^(?=.*\d)[A-Z0-9][A-Z0-9 ./-]{2,39}$/i;
const NOT_A_POLICY_NUMBER = /^(?:[YNX]|Y \/ N|N \/ A)$/;

function cells(line: string): string[] {
  return line
    .trim()
    .split(CELL_SEPARATOR)
    .map((cell) => cell.trim())
    .filter(Boolean);
}

function findLine(lines: string[], pattern: RegExp, from = 0): number {
  for (let i = from; i < lines.length; i++) if (pattern.test(lines[i].trim())) return i;
  return -1;
}

function findLastLine(lines: string[], predicate: (line: string) => boolean): number {
  for (let i = lines.length - 1; i >= 0; i--) if (predicate(lines[i])) return i;
  return -1;
}

/** Lines from `start` up to (not including) the next line matching `end`, searched from `searchFrom`. */
function section(lines: string[], start: number, searchFrom: number, end: RegExp): string[] {
  const stop = findLine(lines, end, searchFrom);
  return lines.slice(start, stop >= 0 ? stop : Math.min(lines.length, searchFrom + 8));
}

/** MM/DD/YYYY or MM/DD/YY → YYYY-MM-DD; null for anything that isn't a real calendar date. */
export function toIsoDate(value: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, mm, dd, yy] = match;
  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  const iso = `${year}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(iso) ? iso : null;
}

/** "INSURER A :   Hartford Casualty Insurance Company   29424" → A → Hartford Casualty Insurance Company. */
function insurerNames(lines: string[]): Map<string, string> {
  const insurers = new Map<string, string>();
  for (const line of lines) {
    for (const match of line.matchAll(/INSURER ([A-F])\s*:\s*(.*)$/g)) {
      const name = cells(match[2])[0]?.replace(/\s+\d{5}$/, '');
      if (name && !/^INSURER\b/.test(name) && !insurers.has(match[1])) insurers.set(match[1], name);
    }
  }
  return insurers;
}

/** Policy number, dates and carrier from a coverage row of the ACORD 25 table. */
function policyRow(sectionLines: string[], insurers: Map<string, string>): Policy {
  const policy: Policy = { carrier: null, policyNumber: null, effectiveDate: null, expiryDate: null };

  for (const line of sectionLines) {
    const match = DATE_PAIR.exec(line);
    if (!match) continue;
    const effective = toIsoDate(match[1]);
    const expiry = toIsoDate(match[2]);
    if (!effective || !expiry || expiry <= effective) continue;
    policy.effectiveDate = effective;
    policy.expiryDate = expiry;
    policy.policyNumber = policyNumberBefore(line.slice(0, match.index));
    break;
  }

  const letter = sectionLines.map((line) => cells(line)[0]).find((cell) => cell !== undefined && /^[A-F]$/.test(cell));
  if (letter && insurers.has(letter)) policy.carrier = insurers.get(letter)!;
  else if (!letter && insurers.size === 1) policy.carrier = [...insurers.values()][0];
  return policy;
}

/** The policy number is the column just before the effective date (or the tail of the same column). */
function policyNumberBefore(prefix: string): string | null {
  const columns = cells(prefix);
  const last = columns.at(-1);
  if (!last) return null;
  // Same column as the date ("GL-55 06/01/2026"): only one space separates them, so take the last word.
  const candidate = /\S $/.test(prefix) ? last.split(' ').at(-1)! : last;
  return POLICY_NUMBER.test(candidate) && !NOT_A_POLICY_NUMBER.test(candidate) ? candidate : null;
}

/** First dollar amount printed after `label`, e.g. "EACH OCCURRENCE   $   1,000,000". */
function moneyAfter(sectionLines: string[], label: RegExp): number | null {
  const pattern = new RegExp(String.raw`${label.source}\s*\$?\s*(\d{1,3}(?:,\d{3})+|\d+)(?![\d,])`);
  for (const line of sectionLines) {
    const match = pattern.exec(line);
    if (match) return Number(match[1].replace(/,/g, ''));
  }
  return null;
}

const LABEL_CELL =
  /^(?:INSURER|INSURED|PRODUCER|CONTACT|PHONE|FAX|E-MAIL|NAIC|COVERAGES|CERTIFICATE|SHOULD ANY|THE EXPIRATION|ACCORDANCE WITH|AUTHORIZED|CANCELLATION|ACORD|\(C\)|©)/;

/** The first line of the INSURED box. */
function namedInsured(lines: string[]): string | null {
  const index = lines.findIndex((line) => /^INSURED\b/.test(cells(line)[0] ?? ''));
  if (index < 0) return null;
  const sameCell = /^INSURED\s+(.+)$/.exec(cells(lines[index])[0])?.[1];
  if (sameCell && !LABEL_CELL.test(sameCell)) return sameCell;
  for (const line of lines.slice(index + 1, index + 4)) {
    const first = cells(line)[0];
    if (first && !LABEL_CELL.test(first)) return first;
  }
  return null;
}

/** The CERTIFICATE HOLDER box: name and address lines, joined with ", ". */
function certificateHolder(lines: string[]): string | null {
  // The phrase also appears in the disclaimer, so use the last line that starts with the label.
  const index = findLastLine(lines, (line) => cells(line)[0] === 'CERTIFICATE HOLDER');
  if (index < 0) return null;
  const parts: string[] = [];
  for (const line of lines.slice(index + 1, index + 6)) {
    const first = cells(line)[0];
    if (!first) continue;
    if (LABEL_CELL.test(first)) break;
    parts.push(first);
  }
  return parts.length ? parts.join(', ') : null;
}

/** Text of the DESCRIPTION OF OPERATIONS box, up to the certificate holder. */
function description(lines: string[]): string | null {
  const start = findLine(lines, /^DESCRIPTION OF OPERATIONS/);
  if (start < 0) return null;
  const end = findLine(lines, /^CERTIFICATE HOLDER\b/, start + 1);
  const body = lines
    .slice(start + 1, end >= 0 ? end : start + 6)
    .map((line) => cells(line).join(' '))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return body || null;
}

/** ISO commercial general liability and auto forms ("CG 20 10 04 13", "CA 20 48"), once each, in order. */
function endorsementForms(text: string): string[] {
  const forms = new Set<string>();
  for (const match of text.matchAll(/\b(?:CG|CA)[\s-]?\d{2}[\s-]?\d{2}(?![\d])/g)) {
    const form = formNumber(match[0]);
    if (form) forms.add(form);
  }
  return [...forms];
}
