import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_FAILURES_IN_A_ROW, MAX_REMINDERS_PER_RUN, REMINDER_WINDOWS, reminderWindow, runReminders } from '../lib/reminders';
import { removeVendor } from '../lib/store';
import { outbox, seedAssociation, seedCheck, seedVendor, testDb, type Outbox, type TestDb } from './helpers/db';
import { TODAY, addDays } from './helpers/fixtures';

let t: TestDb;
let mail: Outbox;

beforeAll(async () => {
  t = await testDb();
});
afterAll(() => t.close());
beforeEach(async () => {
  await t.reset();
  mail = outbox();
});

const run = (today = TODAY, limit?: number) => runReminders({ db: t.db, mailer: mail, today, limit });

/** An association with one vendor whose latest certificate expires `days` after TODAY. */
async function vendorExpiringIn(days: number, patch: Parameters<typeof seedVendor>[2] = {}) {
  const { association } = await seedAssociation(t.db);
  const vendor = await seedVendor(t.db, association.id, patch);
  await seedCheck(t.db, vendor.id, addDays(TODAY, days));
  return { association, vendor };
}

describe('exit criterion 1: expiry in 30 days → exactly one reminder to vendor and agent, none on re-run', () => {
  it('sends one reminder addressed to the vendor with the agent in cc', async () => {
    const { vendor } = await vendorExpiringIn(30);
    const summary = await run();
    expect(summary).toMatchObject({ date: TODAY, sent: 1, failed: 0, deferred: 0 });
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe(vendor.contactEmail);
    expect(mail.sent[0].cc).toBe(vendor.agentEmail);
    expect(mail.sent[0].replyTo).toBe('treasurer@mapleridge.example');
    expect(mail.sent[0].text).toContain(addDays(TODAY, 30));
  });

  it('sends nothing when the job runs again the same day', async () => {
    await vendorExpiringIn(30);
    await run();
    const again = await run();
    expect(again.sent).toBe(0);
    expect(mail.sent).toHaveLength(1);
  });

  it('sends one reminder when two runs overlap', async () => {
    await vendorExpiringIn(30);
    const [a, b] = await Promise.all([run(), run()]);
    expect(a.sent + b.sent).toBe(1);
    expect(mail.sent).toHaveLength(1);
  });
});

describe('exit criterion 2: expiry in 31 days → no reminder', () => {
  it('sends nothing', async () => {
    await vendorExpiringIn(31);
    expect((await run()).sent).toBe(0);
    expect(mail.sent).toHaveLength(0);
  });
});

describe('reminder windows (30 / 14 / 3 days)', () => {
  it('uses the windows from the PRD', () => {
    expect(REMINDER_WINDOWS).toEqual([30, 14, 3]);
  });

  it.each([
    [31, null],
    [30, 30],
    [15, 30],
    [14, 14],
    [4, 14],
    [3, 3],
    [1, 3],
    [0, null],
    [-5, null],
  ])('%i days left → window %s', (days, window) => {
    expect(reminderWindow(days)).toBe(window);
  });

  it.each([14, 3])('sends the %i-day reminder once', async (days) => {
    await vendorExpiringIn(days);
    expect((await run()).sent).toBe(1);
    expect((await run()).sent).toBe(0);
    expect(mail.sent[0].subject).toContain(addDays(TODAY, days));
  });

  it('sends one reminder per window across a certificate’s last 30 days', async () => {
    const { vendor } = await vendorExpiringIn(30);
    const expiry = addDays(TODAY, 30);
    for (let day = 0; day <= 31; day++) await run(addDays(TODAY, day));
    expect(mail.sent).toHaveLength(3);
    expect(mail.sent.map((m) => m.to)).toEqual([vendor.contactEmail, vendor.contactEmail, vendor.contactEmail]);
    expect(mail.sent.map((m) => m.text.match(/in (\d+) days?/)?.[1])).toEqual(['30', '14', '3']);
    expect(mail.sent.every((m) => m.text.includes(expiry))).toBe(true);
  });

  it('catches up on a window when the job did not run on the exact day', async () => {
    await vendorExpiringIn(29);
    expect((await run()).sent).toBe(1);
    expect(mail.sent[0].text).toMatch(/in 29 days/);
    // Next run inside the same window sends nothing; the 14-day window sends again.
    expect((await run(addDays(TODAY, 1))).sent).toBe(0);
    expect((await run(addDays(TODAY, 19))).sent).toBe(1);
  });

  it('sends only the current window to a vendor first seen close to expiry', async () => {
    await vendorExpiringIn(2);
    expect((await run()).sent).toBe(1);
    expect(mail.sent[0].text).toMatch(/in 2 days/);
    expect((await run(addDays(TODAY, 1))).sent).toBe(0);
  });

  it.each([0, -1, -40])('sends nothing for a certificate %i days from expiry (already expired)', async (days) => {
    await vendorExpiringIn(days);
    expect((await run()).sent).toBe(0);
  });

  it('sends nothing to a vendor with no certificate on file', async () => {
    const { association } = await seedAssociation(t.db);
    await seedVendor(t.db, association.id);
    expect((await run()).sent).toBe(0);
  });

  it('sends nothing for a certificate whose expiry could not be read', async () => {
    const { association } = await seedAssociation(t.db);
    const vendor = await seedVendor(t.db, association.id);
    await seedCheck(t.db, vendor.id, null, { failedReasons: ['general liability policy expiry date not found on certificate'] });
    expect((await run()).sent).toBe(0);
  });

  it('sends nothing to a removed vendor', async () => {
    const { association, vendor } = await vendorExpiringIn(30);
    await removeVendor(t.db, association.id, vendor.id);
    expect((await run()).sent).toBe(0);
  });

  it('follows the latest certificate: a renewal stops reminders, and its own expiry starts a new cycle', async () => {
    const { vendor } = await vendorExpiringIn(30);
    expect((await run()).sent).toBe(1);
    await seedCheck(t.db, vendor.id, addDays(TODAY, 365));
    expect((await run(addDays(TODAY, 16))).sent).toBe(0);
    expect((await run(addDays(TODAY, 335))).sent).toBe(1);
    expect(mail.sent[1].text).toContain(addDays(TODAY, 365));
  });

  it('sends to the vendor alone when there is no agent email', async () => {
    await vendorExpiringIn(14, { agentEmail: null });
    await run();
    expect(mail.sent[0].cc).toBeNull();
  });

  it('does not cc the agent twice when the vendor and agent share an address', async () => {
    await vendorExpiringIn(14, { contactEmail: 'office@acme.example', agentEmail: 'Office@Acme.example' });
    await run();
    expect(mail.sent[0].cc).toBeNull();
  });

  it('reminds each vendor of each association', async () => {
    await vendorExpiringIn(30);
    const { association } = await seedAssociation(t.db, { name: 'Oak Hollow Condo Association', contactEmail: 'board@oakhollow.example' });
    const roofer = await seedVendor(t.db, association.id, { name: 'Bright Roofing' });
    await seedCheck(t.db, roofer.id, addDays(TODAY, 3));
    expect((await run()).sent).toBe(2);
    const roofing = mail.sent.find((m) => m.to === roofer.contactEmail);
    expect(roofing?.replyTo).toBe('board@oakhollow.example');
    expect(roofing?.text).toContain('Oak Hollow Condo Association');
  });
});

describe('failures and limits', () => {
  it('releases the claim when sending fails, keeps going, and retries on the next run', async () => {
    const { association, vendor } = await vendorExpiringIn(30);
    const other = await seedVendor(t.db, association.id, { name: 'Bright Roofing' });
    await seedCheck(t.db, other.id, addDays(TODAY, 30));
    mail.failFor.add(vendor.contactEmail);

    const first = await run();
    expect(first).toMatchObject({ sent: 1, failed: 1 });
    expect(mail.sent.map((m) => m.to)).toEqual([other.contactEmail]);

    mail.failFor.clear();
    const retry = await run();
    expect(retry).toMatchObject({ sent: 1, failed: 0 });
    expect(mail.sent.map((m) => m.to)).toEqual([other.contactEmail, vendor.contactEmail]);
  });

  it('stops after repeated failures (mail server down) and leaves the rest for the next run', async () => {
    const { association } = await seedAssociation(t.db);
    const names = ['Alpha Pools', 'Beta Paving', 'Gamma Tree Care', 'Delta Plumbing', 'Echo Electric'];
    for (const [i, name] of names.entries()) {
      const vendor = await seedVendor(t.db, association.id, { name });
      await seedCheck(t.db, vendor.id, addDays(TODAY, 10 + i));
      mail.failFor.add(vendor.contactEmail);
    }
    expect(MAX_FAILURES_IN_A_ROW).toBe(3);
    expect(await run()).toMatchObject({ sent: 0, failed: 3, deferred: 2 });
    expect(await t.db.query('SELECT 1 FROM reminders')).toEqual([]);

    mail.failFor.clear();
    expect(await run()).toMatchObject({ sent: 5, failed: 0, deferred: 0 });
  });

  it('keeps going after a failure followed by a success', async () => {
    const { association } = await seedAssociation(t.db);
    const names = ['Alpha Pools', 'Beta Paving', 'Gamma Tree Care', 'Delta Plumbing', 'Echo Electric'];
    for (const [i, name] of names.entries()) {
      const vendor = await seedVendor(t.db, association.id, { name });
      await seedCheck(t.db, vendor.id, addDays(TODAY, 10 + i));
      if (i % 2 === 0) mail.failFor.add(vendor.contactEmail);
    }
    expect(await run()).toMatchObject({ sent: 2, failed: 3, deferred: 0 });
  });

  it('sends at most the per-run cap and leaves the rest for the next run', async () => {
    const { association } = await seedAssociation(t.db);
    for (const name of ['Alpha Pools', 'Beta Paving', 'Gamma Tree Care']) {
      const vendor = await seedVendor(t.db, association.id, { name });
      await seedCheck(t.db, vendor.id, addDays(TODAY, 10));
    }
    expect(await run(TODAY, 2)).toMatchObject({ sent: 2, deferred: 1 });
    expect(await run(TODAY, 2)).toMatchObject({ sent: 1, deferred: 0 });
    expect(mail.sent).toHaveLength(3);
  });

  it('has a default per-run cap that stays inside a free mail quota (two recipients per reminder)', () => {
    expect(MAX_REMINDERS_PER_RUN * 2).toBeLessThanOrEqual(100);
  });

  it('sends the soonest expiries first when capped', async () => {
    const { association } = await seedAssociation(t.db);
    const later = await seedVendor(t.db, association.id, { name: 'Later Lawn Care' });
    await seedCheck(t.db, later.id, addDays(TODAY, 20));
    const sooner = await seedVendor(t.db, association.id, { name: 'Sooner Snow Removal' });
    await seedCheck(t.db, sooner.id, addDays(TODAY, 2));
    await run(TODAY, 1);
    expect(mail.sent.map((m) => m.to)).toEqual([sooner.contactEmail]);
  });
});
