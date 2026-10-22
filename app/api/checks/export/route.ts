import { handler, requireAssociation } from '../../../../lib/api';
import { isoToday } from '../../../../lib/check';
import { checkLogCsv, checkLogFilename } from '../../../../lib/csv';
import { getDb } from '../../../../lib/db';
import { listChecks } from '../../../../lib/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The board's check log as a CSV download: one row per saved check, with vendor, date, verdict and failed rules. */
export const GET = handler(async (request: Request) => {
  const db = await getDb();
  const association = await requireAssociation(request, db);
  const entries = await listChecks(db, association.id);
  return new Response(checkLogCsv(entries), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${checkLogFilename(association.name, isoToday())}"`,
      'cache-control': 'no-store',
    },
  });
});
