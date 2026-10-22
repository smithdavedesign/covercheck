import type { CheckLogEntry } from './store';

type CsvValue = string | number | null;

/** Lets Excel detect UTF-8, so names like "Café Landscaping" survive. */
const BOM = String.fromCharCode(0xfeff);
/**
 * Cells a spreadsheet would run as a formula (OWASP CSV injection): starting with = + - @, a tab or
 * a carriage return, also after leading spaces. Vendor names and certificate text both reach the export.
 */
const FORMULA_START = /^(?:[\t\r]|\s*[=+\-@])/;
const SLUG_MAX_CHARS = 40;

function cell(value: CsvValue): string {
  let text = value === null ? '' : String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** RFC 4180 CSV: every field quoted, CRLF line endings, formula-safe, with a UTF-8 BOM. */
export function toCsv(rows: CsvValue[][]): string {
  return BOM + rows.map((row) => `${row.map(cell).join(',')}\r\n`).join('');
}

export const CHECK_LOG_COLUMNS = ['Date checked', 'Vendor', 'Verdict', 'Failed rules', 'Reasons', 'Certificate expires'] as const;

/** The board's check log: one row per saved check, for the minutes. */
export function checkLogCsv(entries: CheckLogEntry[]): string {
  return toCsv([
    [...CHECK_LOG_COLUMNS],
    ...entries.map((entry) => [
      entry.checkedOn,
      entry.vendorName,
      entry.verdict === 'pass' ? 'Pass' : 'Fail',
      entry.failed.map((rule) => rule.label).join('; '),
      entry.failed.map((rule) => rule.reason).join('; '),
      entry.expiryDate,
    ]),
  ]);
}

/** `covercheck-checks-<association>-<date>.csv`, ASCII only so it is safe in a Content-Disposition header. */
export function checkLogFilename(associationName: string, date: string): string {
  const slug =
    associationName
      .normalize('NFKD')
      .replace(/\p{M}/gu, '') // accents split off by NFKD: "é" → "e"
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+/, '')
      .slice(0, SLUG_MAX_CHARS)
      .replace(/-+$/, '') || 'association';
  return `covercheck-checks-${slug}-${date}.csv`;
}
