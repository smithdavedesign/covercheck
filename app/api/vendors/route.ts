import { z } from 'zod';
import { HttpError, handler, parse, readJson, requireAssociation } from '../../../lib/api';
import { isoToday } from '../../../lib/check';
import { getDb } from '../../../lib/db';
import { EmailAddress, SingleLineText } from '../../../lib/schema';
import { MAX_VENDORS_PER_ASSOCIATION, addVendor, listVendors, vendorView } from '../../../lib/store';

export const runtime = 'nodejs';

const AddVendorSchema = z.object({
  name: SingleLineText(200),
  contactEmail: EmailAddress,
  /** Blank or omitted → no agent; reminders then go to the vendor alone. */
  agentEmail: z
    .union([z.literal('').transform(() => null), EmailAddress])
    .nullable()
    .optional(),
});

/**
 * The dashboard: the association and its vendors, soonest expiry first, vendors without a
 * certificate last. Status and days left are as of the server's UTC date.
 */
export const GET = handler(async (request: Request) => {
  const db = await getDb();
  const association = await requireAssociation(request, db);
  const today = isoToday();
  const vendors = await listVendors(db, association.id);
  return Response.json({
    association: { name: association.name, contactEmail: association.contactEmail, requirements: association.requirements },
    today,
    vendors: vendors.map((vendor) => vendorView(vendor, association, today)),
  });
});

/** POST JSON `{ name, contactEmail, agentEmail? }` → 201 `{ vendor }`. */
export const POST = handler(async (request: Request) => {
  const db = await getDb();
  const association = await requireAssociation(request, db);
  const input = parse(AddVendorSchema, await readJson(request));
  const result = await addVendor(db, association.id, {
    name: input.name,
    contactEmail: input.contactEmail,
    agentEmail: input.agentEmail ?? null,
  });
  if (!result.ok) {
    throw result.reason === 'duplicate'
      ? new HttpError(409, 'duplicate_vendor', `“${input.name}” is already on your vendor list.`)
      : new HttpError(409, 'vendor_limit', `An association can track up to ${MAX_VENDORS_PER_ASSOCIATION} vendors.`);
  }
  return Response.json({ vendor: vendorView(result.vendor, association, isoToday()) }, { status: 201 });
});
