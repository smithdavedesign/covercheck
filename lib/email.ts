import { daysBetween, formNumber } from './check';
import type { Requirements } from './schema';

/** Days before expiry when the vendor and their agent are reminded. */
export const REMINDER_WINDOWS = [30, 14, 3] as const;

/** Keeps a request email short enough for a `mailto:` link. */
const MAX_LISTED_REASONS = 6;
const MAX_REASON_CHARS = 160;

export interface EmailContent {
  subject: string;
  text: string;
}

interface TemplateInput {
  vendorName: string;
  associationName: string;
  requirements: Requirements;
}

/** What a certificate must show to satisfy the association, one plain-English line per requirement. */
export function requirementLines(requirements: Requirements, associationName: string): string[] {
  const lines: string[] = [];
  const { eachOccurrence, aggregate } = requirements.generalLiability;
  const limits = [
    eachOccurrence !== null ? `${money(eachOccurrence)} each occurrence` : null,
    aggregate !== null ? `${money(aggregate)} general aggregate` : null,
  ].filter((limit): limit is string => limit !== null);
  if (limits.length) lines.push(`General liability: at least ${limits.join(' and ')}`);
  if (requirements.workersCompRequired) lines.push('Workers’ compensation coverage');
  if (requirements.certificateHolder) lines.push(`“${requirements.certificateHolder}” as certificate holder`);
  if (requirements.requiredEndorsements.length) {
    const forms = requirements.requiredEndorsements.map((form) => formNumber(form) ?? form);
    const noun = forms.length === 1 ? 'endorsement' : 'endorsements';
    lines.push(`${associationName} as additional insured, with ${noun} ${joinWords(forms)} attached`);
  }
  if (requirements.additionalInsuredWording) lines.push('Additional insured wording in the description of operations');
  return lines;
}

/** The automated reminder sent 30, 14 and 3 days before a certificate expires. */
export function reminderEmail(input: TemplateInput & { expiryDate: string; daysLeft: number }): EmailContent {
  const { vendorName, associationName, requirements, expiryDate, daysLeft } = input;
  const lines = requirementLines(requirements, associationName);
  return {
    subject: `Your certificate of insurance for ${associationName} expires on ${expiryDate}`,
    text: [
      `Hello ${vendorName},`,
      '',
      `The certificate of insurance ${associationName} has on file for ${vendorName} expires on ${expiryDate}, in ${plural(daysLeft, 'day')}.`,
      '',
      ...askForCertificate('Please ask your insurance agent to send a renewed certificate before then.', lines),
      '',
      `Reply to this email with the new certificate and the endorsement pages; your reply goes to ${associationName}.`,
      '',
      'Thank you,',
      associationName,
      '',
      '--',
      `Sent by covercheck on behalf of ${associationName}. Reminders go out ${joinWords(REMINDER_WINDOWS.map(String))} days before a certificate expires.`,
    ].join('\n'),
  };
}

/** The "request updated certificate" email a board member sends from their own mail client. */
export function requestEmail(
  input: TemplateInput & { today: string; checkedOn: string | null; expiryDate: string | null; failedReasons: string[] },
): EmailContent {
  const { vendorName, associationName, requirements } = input;
  return {
    subject: `Updated certificate of insurance needed for ${associationName}`,
    text: [
      `Hello ${vendorName},`,
      '',
      ...situation(input),
      '',
      ...askForCertificate(
        'Please ask your insurance agent to send an updated certificate of insurance.',
        requirementLines(requirements, associationName),
      ),
      '',
      'Please reply with the certificate and the endorsement pages.',
      '',
      'Thank you,',
      associationName,
    ].join('\n'),
  };
}

function situation(input: Parameters<typeof requestEmail>[0]): string[] {
  const { vendorName, associationName, today, checkedOn, expiryDate, failedReasons } = input;
  if (checkedOn === null) return [`We don’t have a certificate of insurance on file for ${vendorName} yet.`];
  if (failedReasons.length) {
    const listed = failedReasons.slice(0, MAX_LISTED_REASONS).map((reason) => `- ${truncate(reason, MAX_REASON_CHARS)}`);
    const more = failedReasons.length - listed.length;
    return [
      `The certificate of insurance we have on file for you (checked on ${checkedOn}) does not meet ${associationName}’s requirements:`,
      ...listed,
      ...(more > 0 ? [`- …and ${more} more`] : []),
    ];
  }
  if (expiryDate) {
    const verb = daysBetween(today, expiryDate) <= 0 ? 'expired' : 'expires';
    return [`The certificate of insurance we have on file for you ${verb} on ${expiryDate}.`];
  }
  return ['We need an updated certificate of insurance from you.'];
}

function askForCertificate(request: string, lines: string[]): string[] {
  return lines.length ? [`${request} It needs to show:`, ...lines.map((line) => `- ${line}`)] : [request];
}

/** The agent's address for cc, unless there is none or it is the vendor's own address. */
export function ccAddress(to: string, agent: string | null): string | null {
  return agent && agent.trim().toLowerCase() !== to.trim().toLowerCase() ? agent : null;
}

/**
 * A `mailto:` link (RFC 6068). Subject and body are fully percent-encoded, so their content
 * can't add recipients or headers; addresses are validated before they get here.
 */
export function mailtoHref(input: { to: string; cc?: string | null; subject: string; body: string }): string {
  const params = [
    ...(input.cc ? [`cc=${encodeURIComponent(input.cc)}`] : []),
    `subject=${encodeURIComponent(input.subject)}`,
    `body=${encodeURIComponent(input.body.replace(/\r?\n/g, '\r\n'))}`,
  ];
  return `mailto:${input.to.replace(/[^A-Za-z0-9.@_+'-]/g, encodeURIComponent)}?${params.join('&')}`;
}

function money(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** ["a"] → "a"; ["a", "b"] → "a and b"; ["a", "b", "c"] → "a, b and c". */
function joinWords(words: readonly string[]): string {
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} and ${words.at(-1)}`;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}
