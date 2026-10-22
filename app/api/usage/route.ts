import { handler, requireBearerSecret } from '../../../lib/api';
import { getDb } from '../../../lib/db';
import { usageCounts } from '../../../lib/usage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The demand test's counts for the operator, with `Authorization: Bearer $STATS_SECRET`:
 * `{ uploads, passes, fails, days: [{ date, uploads, passes, fails }] }`, days in UTC.
 */
export const GET = handler(async (request: Request) => {
  requireBearerSecret(request, process.env.STATS_SECRET, {
    code: 'stats_not_configured',
    message: 'Usage counts are not configured (STATS_SECRET is not set).',
  });
  return Response.json(await usageCounts(await getDb()), { headers: { 'cache-control': 'no-store' } });
});
