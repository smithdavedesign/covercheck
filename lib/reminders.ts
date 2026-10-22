import { createTransport, type Transporter } from 'nodemailer';
import type { Db } from './db';
import { REMINDER_WINDOWS, ccAddress, reminderEmail } from './email';
import { RequirementsSchema } from './schema';

export { REMINDER_WINDOWS };

/**
 * Most reminders sent in one run. Each reminder has up to two recipients, so 40 stays inside a
 * 100-recipients-a-day free mail quota; anything over the cap is sent on the next run.
 */
export const MAX_REMINDERS_PER_RUN = 40;
/** Consecutive failed sends after which a run gives up (3 × the SMTP timeout stays inside the function limit). */
export const MAX_FAILURES_IN_A_ROW = 3;

export interface Email {
  to: string;
  cc: string | null;
  replyTo: string | null;
  subject: string;
  text: string;
}

export interface Mailer {
  /** Resolves once the mail server has accepted the message; rejects otherwise. */
  send(email: Email): Promise<void>;
  /** Releases connections once a run is over. */
  close?(): void;
}

export interface ReminderRun {
  date: string;
  sent: number;
  failed: number;
  /** Due reminders left for the next run because of the per-run cap. */
  deferred: number;
}

/** The reminder window for a certificate expiring in `daysLeft` days: the smallest window that covers it. */
export function reminderWindow(daysLeft: number): number | null {
  if (daysLeft <= 0) return null;
  const covering = REMINDER_WINDOWS.filter((window) => window >= daysLeft);
  return covering.length ? Math.min(...covering) : null;
}

interface DueRow {
  vendor_id: string;
  vendor_name: string;
  contact_email: string;
  agent_email: string | null;
  association_name: string;
  association_email: string;
  requirements: unknown;
  expiry_date: string;
  days_left: number;
  window_days: number;
}

/**
 * Active vendors whose latest certificate is inside a reminder window that hasn't been sent yet,
 * soonest expiry first. Same rule as {@link reminderWindow}, so a missed day is caught up on the next run.
 */
const DUE_SQL = `
  WITH latest AS (
    SELECT DISTINCT ON (vendor_id) vendor_id, expiry_date FROM checks ORDER BY vendor_id, id DESC
  ), due AS (
    SELECT v.id AS vendor_id, v.name AS vendor_name, v.contact_email, v.agent_email,
           a.name AS association_name, a.contact_email AS association_email, a.requirements,
           l.expiry_date, l.expiry_date - $1::date AS days_left,
           (SELECT min(w) FROM unnest($2::int[]) AS w WHERE w >= l.expiry_date - $1::date) AS window_days
    FROM latest l
    JOIN vendors v ON v.id = l.vendor_id AND v.removed_at IS NULL
    JOIN associations a ON a.id = v.association_id
    WHERE l.expiry_date > $1::date
  )
  SELECT vendor_id, vendor_name, contact_email, agent_email, association_name, association_email, requirements,
         expiry_date::text AS expiry_date, days_left, window_days
  FROM due
  WHERE window_days IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM reminders r
      WHERE r.vendor_id = due.vendor_id AND r.expiry_date = due.expiry_date AND r.window_days = due.window_days
    )
  ORDER BY due.expiry_date, due.vendor_id`;

/** Atomically claims a (vendor, expiry, window) reminder; returns no row when another run already has it. */
const CLAIM_SQL = `
  INSERT INTO reminders (vendor_id, expiry_date, window_days, to_email, cc_email)
  VALUES ($1::uuid, $2::date, $3::int, $4, $5)
  ON CONFLICT (vendor_id, expiry_date, window_days) DO NOTHING
  RETURNING id::text AS id`;

/**
 * The daily reminder job. Each reminder is claimed before it is sent, so re-runs and overlapping
 * runs never send it twice. A failed send gives the claim back for the next run to retry; a run
 * that dies mid-send leaves the claim in place (at most once, never a duplicate).
 */
export async function runReminders(options: { db: Db; mailer: Mailer; today: string; limit?: number }): Promise<ReminderRun> {
  const { db, mailer, today, limit = MAX_REMINDERS_PER_RUN } = options;
  const due = await db.query<DueRow>(DUE_SQL, [today, `{${REMINDER_WINDOWS.join(',')}}`]);
  const batch = due.slice(0, limit);
  let sent = 0;
  let failed = 0;
  let failedInARow = 0;
  let processed = 0;

  for (const row of batch) {
    // The mail server is probably down: stop before the function times out and leave the rest for the next run.
    if (failedInARow >= MAX_FAILURES_IN_A_ROW) break;
    processed++;
    const cc = ccAddress(row.contact_email, row.agent_email);
    const content = reminderEmail({
      vendorName: row.vendor_name,
      associationName: row.association_name,
      requirements: RequirementsSchema.parse(row.requirements),
      expiryDate: row.expiry_date,
      daysLeft: row.days_left,
    });
    const [claim] = await db.query<{ id: string }>(CLAIM_SQL, [row.vendor_id, row.expiry_date, row.window_days, row.contact_email, cc]);
    if (!claim) continue;

    try {
      await mailer.send({ to: row.contact_email, cc, replyTo: row.association_email, ...content });
    } catch (error) {
      failed++;
      failedInARow++;
      await db.query('DELETE FROM reminders WHERE id = $1::bigint', [claim.id]);
      console.error('covercheck: reminder not sent, will retry next run', { vendorId: row.vendor_id, code: errorCode(error) });
      continue;
    }
    failedInARow = 0;
    await db.query(`UPDATE reminders SET status = 'sent', sent_at = now() WHERE id = $1::bigint`, [claim.id]);
    sent++;
  }

  return { date: today, sent, failed, deferred: due.length - processed };
}

/** A short, address-free description of a send failure for the logs. */
function errorCode(error: unknown): string {
  if (error && typeof error === 'object') {
    const { code, responseCode } = error as { code?: unknown; responseCode?: unknown };
    if (code || responseCode) return [code, responseCode].filter(Boolean).join(' ');
  }
  return error instanceof Error ? error.name : 'unknown';
}

// ── Mail transport ─────────────────────────────────────────────────────────────

/** Messages per second over the one pooled connection; Resend's SMTP allows 2. */
const SMTP_MESSAGES_PER_SECOND = 2;
/**
 * nodemailer waits up to 10 minutes on a silent server by default, far past the 60 s function limit.
 * Failing fast turns a hung server into an ordinary failed send, whose claim is released for the next run.
 */
const SMTP_TIMEOUT_MS = 15_000;

/** Sends through any SMTP server: a Gmail app password today, Resend's SMTP once there is a domain. */
function smtpMailer(url: string, from: string): Mailer {
  // One reused connection instead of a TLS handshake per message keeps a full run inside the function timeout.
  return nodemailerMailer(
    createTransport({
      url,
      pool: true,
      maxConnections: 1,
      rateDelta: 1000,
      rateLimit: SMTP_MESSAGES_PER_SECOND,
      connectionTimeout: SMTP_TIMEOUT_MS,
      greetingTimeout: SMTP_TIMEOUT_MS,
      socketTimeout: SMTP_TIMEOUT_MS,
    }),
    from,
  );
}

/** Adapts a nodemailer transport to {@link Mailer}. Plain-text mail only. */
export function nodemailerMailer(transport: Transporter, from: string): Mailer {
  return {
    async send(email) {
      await transport.sendMail({
        from,
        to: email.to,
        cc: email.cc ?? undefined,
        replyTo: email.replyTo ?? undefined,
        subject: email.subject,
        text: email.text,
      });
    },
    close: () => transport.close(),
  };
}

type Env = Record<string, string | undefined>;

/** The SMTP mailer when SMTP_URL and EMAIL_FROM are both set; otherwise none. */
export function mailerFromEnv(env: Env): Mailer | null {
  return env.SMTP_URL && env.EMAIL_FROM ? smtpMailer(env.SMTP_URL, env.EMAIL_FROM) : null;
}

let override: Mailer | null | undefined;

export function getMailer(): Mailer | null {
  return override === undefined ? mailerFromEnv(process.env) : override;
}

/** Swaps in another mailer (tests); `undefined` goes back to the environment's. */
export function setMailer(mailer: Mailer | null | undefined): void {
  override = mailer;
}
