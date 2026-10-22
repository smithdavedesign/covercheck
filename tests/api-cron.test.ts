import { createTransport } from 'nodemailer';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '../app/api/cron/reminders/route';
import { setDb } from '../lib/db';
import { mailerFromEnv, nodemailerMailer, setMailer, type Email } from '../lib/reminders';
import { outbox, seedAssociation, seedCheck, seedVendor, testDb, type Outbox, type TestDb } from './helpers/db';
import { addDays, utcToday } from './helpers/fixtures';

let t: TestDb;
let mail: Outbox;
/** A throwaway value built at runtime; the real secret only ever lives in the Vercel env. */
const secret = ['cron', 'test', 'Q7w9E2r4'.repeat(4)].join('-');

beforeAll(async () => {
  t = await testDb();
  setDb(t.db);
});
afterAll(async () => {
  setDb(null);
  await t.close();
});
beforeEach(async () => {
  await t.reset();
  mail = outbox();
  setMailer(mail);
  vi.stubEnv('CRON_SECRET', secret);
});
afterEach(() => {
  setMailer(undefined);
  vi.unstubAllEnvs();
});

const call = (authorization?: string) =>
  GET(new Request('http://localhost/api/cron/reminders', { headers: authorization ? { authorization } : {} }));

async function vendorExpiringIn(days: number) {
  const { association } = await seedAssociation(t.db);
  const vendor = await seedVendor(t.db, association.id);
  await seedCheck(t.db, vendor.id, addDays(utcToday(), days));
  return vendor;
}

describe('GET /api/cron/reminders', () => {
  it('exit criterion 1: sends one reminder to vendor and agent for a certificate expiring in 30 days, none on re-run', async () => {
    const vendor = await vendorExpiringIn(30);
    const first = await call(`Bearer ${secret}`);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ date: utcToday(), sent: 1, failed: 0, deferred: 0 });
    expect(mail.sent.map((m) => [m.to, m.cc])).toEqual([[vendor.contactEmail, vendor.agentEmail]]);

    const again = await call(`Bearer ${secret}`);
    expect((await again.json()).sent).toBe(0);
    expect(mail.sent).toHaveLength(1);
  });

  it('exit criterion 2: sends nothing for a certificate expiring in 31 days', async () => {
    await vendorExpiringIn(31);
    expect((await (await call(`Bearer ${secret}`)).json()).sent).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });

  it.each([
    ['no authorization header', undefined],
    ['a wrong secret', `Bearer ${secret}x`],
    ['the secret without the Bearer scheme', secret],
  ])('rejects %s with 401 and sends nothing', async (_label, authorization) => {
    await vendorExpiringIn(30);
    const response = await call(authorization);
    expect(response.status).toBe(401);
    expect(mail.sent).toHaveLength(0);
  });

  it('refuses to run when CRON_SECRET is not configured, even for "Bearer undefined"', async () => {
    await vendorExpiringIn(30);
    vi.stubEnv('CRON_SECRET', '');
    for (const authorization of [undefined, 'Bearer undefined', 'Bearer ']) {
      expect((await call(authorization)).status).toBe(503);
    }
    expect(mail.sent).toHaveLength(0);
  });

  it('refuses to run without a mail transport, and claims nothing', async () => {
    await vendorExpiringIn(30);
    setMailer(null);
    const response = await call(`Bearer ${secret}`);
    expect(response.status).toBe(503);
    expect((await response.json()).error).toBe('email_not_configured');
    expect(await t.db.query('SELECT 1 FROM reminders')).toEqual([]);
  });
});

describe('GET /api/cron/reminders connections', () => {
  it('closes the mail connection after the run', async () => {
    await vendorExpiringIn(3);
    const close = vi.fn();
    mail.close = close;
    expect((await call(`Bearer ${secret}`)).status).toBe(200);
    expect(close).toHaveBeenCalledOnce();
  });
});

describe('nodemailerMailer', () => {
  async function rawMessage(email: Email): Promise<string> {
    let raw = '';
    const transport = createTransport({ streamTransport: true, buffer: true });
    const send = transport.sendMail.bind(transport);
    vi.spyOn(transport, 'sendMail').mockImplementation(async (message) => {
      const info = await send(message);
      raw = String((info as { message: Buffer }).message);
      return info;
    });
    await nodemailerMailer(transport, 'covercheck <reminders@example.com>').send(email);
    // Unfold long headers (RFC 5322 folding) so each header is one line.
    return raw.replace(/\r\n[ \t]+/g, ' ');
  }

  it('sends plain text to the vendor, cc the agent, reply-to the board', async () => {
    const raw = await rawMessage({
      to: 'office@acme.example',
      cc: 'certs@agent.example',
      replyTo: 'treasurer@mapleridge.example',
      subject: 'Your certificate of insurance for Maple Ridge HOA expires on 2026-11-21',
      text: 'Hello Acme Landscaping,',
    });
    expect(raw).toMatch(/^From: covercheck <reminders@example\.com>$/m);
    expect(raw).toMatch(/^To: office@acme\.example$/m);
    expect(raw).toMatch(/^Cc: certs@agent\.example$/m);
    expect(raw).toMatch(/^Reply-To: treasurer@mapleridge\.example$/m);
    expect(raw).toMatch(/^Subject: Your certificate of insurance for Maple Ridge HOA expires on 2026-11-21$/m);
    expect(raw).toMatch(/^Content-Type: text\/plain/m);
    expect(raw).toContain('Hello Acme Landscaping,');
  });

  it('leaves out Cc and Reply-To when there are none, and keeps a line break in the subject out of the headers', async () => {
    const raw = await rawMessage({ to: 'office@acme.example', cc: null, replyTo: null, subject: 'Hi\r\nBcc: evil@example.com', text: 'x' });
    expect(raw).not.toMatch(/^Cc:/m);
    expect(raw).not.toMatch(/^Reply-To:/m);
    expect(raw).not.toMatch(/^Bcc:/m);
  });
});

describe('mailerFromEnv', () => {
  it('needs both SMTP_URL and EMAIL_FROM', () => {
    const smtpUrl = ['smtps', '//mailer.invalid:465'].join(':');
    expect(mailerFromEnv({})).toBeNull();
    expect(mailerFromEnv({ SMTP_URL: smtpUrl })).toBeNull();
    expect(mailerFromEnv({ EMAIL_FROM: 'covercheck <reminders@example.com>' })).toBeNull();
    expect(mailerFromEnv({ SMTP_URL: smtpUrl, EMAIL_FROM: 'covercheck <reminders@example.com>' })).not.toBeNull();
  });
});
