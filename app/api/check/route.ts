import { z } from 'zod';
import { handler, parse, readJson, resolveAsOf } from '../../../lib/api';
import { DISCLAIMER, check } from '../../../lib/check';
import { CoiFieldsSchema, DEFAULT_REQUIREMENTS, RequirementsSchema } from '../../../lib/schema';
import { trackUsage } from '../../../lib/usage';

export const runtime = 'nodejs';

const CheckRequestSchema = z.object({
  vendorName: z.string().trim().min(1).max(300),
  fields: CoiFieldsSchema,
  /** Omitted → the default association template. */
  requirements: RequirementsSchema.optional(),
  /** The board's local date (YYYY-MM-DD); defaults to the server's UTC date. */
  asOf: z.iso.date().optional(),
});

/** POST JSON `{ vendorName, fields, requirements?, asOf? }` → verdict with one result per rule. Only the verdict is counted. */
export const POST = handler(async (request: Request) => {
  const { vendorName, fields, requirements, asOf } = parse(CheckRequestSchema, await readJson(request));
  const result = check(fields, requirements ?? DEFAULT_REQUIREMENTS, { vendorName, today: resolveAsOf(asOf) });
  await trackUsage(result.verdict);
  return Response.json({ ...result, disclaimer: DISCLAIMER });
});
