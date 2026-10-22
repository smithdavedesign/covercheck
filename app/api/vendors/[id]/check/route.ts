import { z } from 'zod';
import { HttpError, handler, parse, readJson, requireAssociation, resolveAsOf } from '../../../../../lib/api';
import { DISCLAIMER, check, isoToday } from '../../../../../lib/check';
import { getDb } from '../../../../../lib/db';
import { CoiFieldsSchema } from '../../../../../lib/schema';
import { certificateExpiry, findVendor, recordCheck, vendorView } from '../../../../../lib/store';
import { trackUsage } from '../../../../../lib/usage';

export const runtime = 'nodejs';

const VendorCheckSchema = z.object({
  fields: CoiFieldsSchema,
  /** The board's local date (YYYY-MM-DD); defaults to the server's UTC date. */
  asOf: z.iso.date().optional(),
});

/**
 * POST JSON `{ fields, asOf? }`: checks the confirmed certificate fields against the association's
 * stored requirements and the vendor's stored name, saves the result as the vendor's latest check,
 * and returns the verdict (same shape as `/api/check`) plus the updated vendor.
 */
export const POST = handler(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const association = await requireAssociation(request, db);
  const { id } = await context.params;
  const vendor = await findVendor(db, association.id, id);
  if (!vendor) throw new HttpError(404, 'not_found', 'That vendor is not on your list.');

  const { fields, asOf } = parse(VendorCheckSchema, await readJson(request));
  const result = check(fields, association.requirements, { vendorName: vendor.name, today: resolveAsOf(asOf) });
  await recordCheck(db, vendor.id, {
    checkedOn: result.asOf,
    verdict: result.verdict,
    expiryDate: certificateExpiry(fields, association.requirements),
    results: result.results,
  });
  await trackUsage(result.verdict);

  const saved = await findVendor(db, association.id, vendor.id);
  return Response.json({
    ...result,
    disclaimer: DISCLAIMER,
    vendor: saved && vendorView(saved, association, isoToday()),
  });
});
