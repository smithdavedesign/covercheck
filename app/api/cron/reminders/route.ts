import { HttpError, handler, requireBearerSecret } from '../../../../lib/api';
import { isoToday } from '../../../../lib/check';
import { getDb } from '../../../../lib/db';
import { getMailer, runReminders } from '../../../../lib/reminders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * The daily reminder job, called by Vercel Cron (see vercel.json) with `Authorization: Bearer $CRON_SECRET`.
 * Sends the 30/14/3-day reminders due on today's UTC date and returns `{ date, sent, failed, deferred }`.
 */
export const GET = handler(async (request: Request) => {
  requireBearerSecret(request, process.env.CRON_SECRET, {
    code: 'cron_not_configured',
    message: 'The reminder job is not configured (CRON_SECRET is not set).',
  });
  const mailer = getMailer();
  if (!mailer) throw new HttpError(503, 'email_not_configured', 'Reminders need SMTP_URL and EMAIL_FROM to be set.');

  try {
    return Response.json(await runReminders({ db: await getDb(), mailer, today: isoToday() }));
  } finally {
    mailer.close?.();
  }
});
