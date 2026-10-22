import { describe, expect, it } from 'vitest';
import { mailtoHref, reminderEmail, requestEmail, requirementLines } from '../lib/email';
import { DEFAULT_REQUIREMENTS, type Requirements } from '../lib/schema';
import { TODAY } from './helpers/fixtures';

const requirements: Requirements = { ...DEFAULT_REQUIREMENTS, certificateHolder: 'Maple Ridge Homeowners Association' };
const base = { vendorName: 'Acme Landscaping', associationName: 'Maple Ridge HOA', requirements };

describe('requirementLines', () => {
  it('spells out every requirement of the default template', () => {
    expect(requirementLines(requirements, 'Maple Ridge HOA')).toEqual([
      'General liability: at least $1,000,000 each occurrence and $2,000,000 general aggregate',
      'Workers’ compensation coverage',
      '“Maple Ridge Homeowners Association” as certificate holder',
      'Maple Ridge HOA as additional insured, with endorsements CG 20 10 and CG 20 37 attached',
      'Additional insured wording in the description of operations',
    ]);
  });

  it('leaves out requirements the association does not set', () => {
    const lines = requirementLines(
      {
        ...requirements,
        certificateHolder: '',
        generalLiability: { eachOccurrence: 500_000, aggregate: null },
        workersCompRequired: false,
        requiredEndorsements: [],
        additionalInsuredWording: false,
      },
      'Maple Ridge HOA',
    );
    expect(lines).toEqual(['General liability: at least $500,000 each occurrence']);
  });
});

describe('reminderEmail', () => {
  const email = reminderEmail({ ...base, expiryDate: '2026-11-21', daysLeft: 30 });

  it('names the association and the expiry date in the subject', () => {
    expect(email.subject).toBe('Your certificate of insurance for Maple Ridge HOA expires on 2026-11-21');
  });

  it('says when the certificate expires and what the renewal must show', () => {
    expect(email.text).toContain('Hello Acme Landscaping,');
    expect(email.text).toContain('expires on 2026-11-21, in 30 days');
    for (const line of requirementLines(requirements, 'Maple Ridge HOA')) expect(email.text).toContain(`- ${line}`);
    expect(email.text).toContain('Reply to this email');
    expect(email.text).toContain('30, 14 and 3 days');
  });

  it('uses the singular for one day', () => {
    expect(reminderEmail({ ...base, expiryDate: '2026-10-23', daysLeft: 1 }).text).toContain('in 1 day.');
  });
});

describe('requestEmail', () => {
  it('lists the failed requirements from the last check', () => {
    const email = requestEmail({
      ...base,
      today: TODAY,
      checkedOn: '2026-10-20',
      expiryDate: '2027-03-01',
      failedReasons: [
        'additional insured endorsement missing: CG 20 37 not listed on certificate',
        'each-occurrence limit $500,000 is below the required $1,000,000',
      ],
    });
    expect(email.subject).toBe('Updated certificate of insurance needed for Maple Ridge HOA');
    expect(email.text).toContain('checked on 2026-10-20');
    expect(email.text).toContain('- additional insured endorsement missing: CG 20 37 not listed on certificate');
    expect(email.text).toContain('- each-occurrence limit $500,000 is below the required $1,000,000');
    expect(email.text).toContain('- Workers’ compensation coverage');
  });

  it('asks for a renewal when the certificate passed but expires soon or has expired', () => {
    const soon = requestEmail({ ...base, today: TODAY, checkedOn: TODAY, expiryDate: '2026-11-01', failedReasons: [] });
    expect(soon.text).toContain('expires on 2026-11-01');
    const expired = requestEmail({ ...base, today: TODAY, checkedOn: '2026-01-01', expiryDate: '2026-10-01', failedReasons: [] });
    expect(expired.text).toContain('expired on 2026-10-01');
  });

  it('asks for a first certificate when none is on file', () => {
    const email = requestEmail({ ...base, today: TODAY, checkedOn: null, expiryDate: null, failedReasons: [] });
    expect(email.text).toContain('We don’t have a certificate of insurance on file for Acme Landscaping yet.');
  });

  it('keeps the body short enough for a mailto link', () => {
    const email = requestEmail({
      ...base,
      today: TODAY,
      checkedOn: TODAY,
      expiryDate: '2027-03-01',
      failedReasons: Array.from({ length: 12 }, (_, i) => `reason ${i} `.padEnd(400, 'x')),
    });
    expect(email.text.match(/^- reason/gm)).toHaveLength(6);
    expect(email.text).toContain('and 6 more');
    expect(email.text.length).toBeLessThan(2000);
  });
});

describe('mailtoHref', () => {
  it('addresses the vendor, copies the agent and encodes subject and body', () => {
    const href = mailtoHref({ to: 'office@acme.example', cc: 'certs@agent.example', subject: 'A & B?', body: 'Line 1\nLine 2 = 100%' });
    expect(href).toBe(
      'mailto:office@acme.example?cc=certs%40agent.example&subject=A%20%26%20B%3F&body=Line%201%0D%0ALine%202%20%3D%20100%25',
    );
  });

  it('leaves out cc when there is no agent', () => {
    expect(mailtoHref({ to: 'office@acme.example', cc: null, subject: 'S', body: 'B' })).toBe(
      'mailto:office@acme.example?subject=S&body=B',
    );
  });

  it('cannot be used to add recipients or headers through the subject or body', () => {
    const href = mailtoHref({ to: 'office@acme.example', cc: null, subject: 'x&bcc=evil@example.com', body: '?to=evil@example.com' });
    const params = new URL(href).searchParams;
    expect([...params.keys()]).toEqual(['subject', 'body']);
    expect(params.get('subject')).toBe('x&bcc=evil@example.com');
  });
});
