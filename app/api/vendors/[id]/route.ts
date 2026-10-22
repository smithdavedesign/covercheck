import { HttpError, handler, requireAssociation } from '../../../../lib/api';
import { getDb } from '../../../../lib/db';
import { removeVendor } from '../../../../lib/store';

export const runtime = 'nodejs';

/** Removes the vendor from the list and from reminders. Its saved checks are kept. */
export const DELETE = handler(async (request: Request, context: { params: Promise<{ id: string }> }) => {
  const db = await getDb();
  const association = await requireAssociation(request, db);
  const { id } = await context.params;
  if (!(await removeVendor(db, association.id, id))) throw new HttpError(404, 'not_found', 'That vendor is not on your list.');
  return new Response(null, { status: 204 });
});
