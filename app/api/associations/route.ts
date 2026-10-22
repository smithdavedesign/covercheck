import { z } from 'zod';
import { handler, parse, readJson } from '../../../lib/api';
import { getDb } from '../../../lib/db';
import { DEFAULT_REQUIREMENTS, EmailAddress, RequirementsSchema, SingleLineText } from '../../../lib/schema';
import { createAssociation } from '../../../lib/store';

export const runtime = 'nodejs';

const CreateAssociationSchema = z.object({
  name: SingleLineText(200),
  /** The board member vendors reply to. */
  contactEmail: EmailAddress,
  /** Omitted → the default association template. */
  requirements: RequirementsSchema.optional(),
});

/**
 * POST JSON `{ name, contactEmail, requirements? }` → 201 `{ association, key }`.
 * The key is shown only here; the dashboard link is `/dashboard#k=<key>`.
 */
export const POST = handler(async (request: Request) => {
  const input = parse(CreateAssociationSchema, await readJson(request));
  const base = input.requirements ?? DEFAULT_REQUIREMENTS;
  // The association itself is the usual certificate holder.
  const requirements = { ...base, certificateHolder: base.certificateHolder || input.name };
  const { association, key } = await createAssociation(await getDb(), {
    name: input.name,
    contactEmail: input.contactEmail,
    requirements,
  });
  return Response.json({ association: { id: association.id, name: association.name }, key }, { status: 201 });
});
