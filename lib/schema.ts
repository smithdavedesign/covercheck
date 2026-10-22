import { z } from 'zod';
import defaultTemplate from '../config/default-requirements.json';

/** Upload cap for certificate PDFs: below Vercel's 4.5 MB request-body limit, leaving room for the multipart envelope. */
export const MAX_PDF_BYTES = 4 * 1024 * 1024;

/** Calendar date as `YYYY-MM-DD`; impossible dates such as 2027-02-30 are rejected. */
const IsoDate = z.iso.date();
const Money = z.number().int().nonnegative().max(10_000_000_000);
const Text = (max: number) => z.string().trim().max(max);

/** Size caps on certificate fields, shared by the API schema and the extractor. */
export const FIELD_LIMITS = {
  carrier: 200,
  policyNumber: 100,
  namedInsured: 300,
  certificateHolder: 500,
  description: 5000,
  endorsement: 60,
  endorsements: 50,
} as const;

const PolicyShape = {
  carrier: Text(FIELD_LIMITS.carrier).nullable().default(null),
  policyNumber: Text(FIELD_LIMITS.policyNumber).nullable().default(null),
  effectiveDate: IsoDate.nullable().default(null),
  expiryDate: IsoDate.nullable().default(null),
};

export const PolicySchema = z.object(PolicyShape);

export const GeneralLiabilitySchema = z.object({
  ...PolicyShape,
  eachOccurrence: Money.nullable().default(null),
  aggregate: Money.nullable().default(null),
});

/**
 * The fields read from a certificate of insurance (ACORD 25), after the board has confirmed them.
 * `null` means "not found on the certificate"; rules treat it as a failure, never as a pass.
 */
export const CoiFieldsSchema = z.object({
  namedInsured: Text(FIELD_LIMITS.namedInsured).nullable().default(null),
  /** The whole certificate-holder box: name and address. */
  certificateHolder: Text(FIELD_LIMITS.certificateHolder).nullable().default(null),
  generalLiability: GeneralLiabilitySchema.default(() => GeneralLiabilitySchema.parse({})),
  workersComp: PolicySchema.nullable().default(null),
  /** Endorsement form numbers such as "CG 20 10". */
  endorsements: z.array(Text(FIELD_LIMITS.endorsement)).max(FIELD_LIMITS.endorsements).default([]),
  /** Description of operations / locations / vehicles. */
  description: Text(FIELD_LIMITS.description).nullable().default(null),
});

export type Policy = z.infer<typeof PolicySchema>;
export type CoiFields = z.infer<typeof CoiFieldsSchema>;

export function emptyFields(): CoiFields {
  return CoiFieldsSchema.parse({});
}

/** What an association requires of each vendor's certificate. `null` limits mean "no minimum". */
export const RequirementsSchema = z.object({
  name: Text(200).default('Association requirements'),
  /** The association's name as it must appear as certificate holder; empty skips the rule. */
  certificateHolder: Text(300).default(''),
  generalLiability: z
    .object({
      eachOccurrence: Money.nullable().default(null),
      aggregate: Money.nullable().default(null),
    })
    .default({ eachOccurrence: null, aggregate: null }),
  workersCompRequired: z.boolean().default(false),
  requiredEndorsements: z.array(Text(60).min(1)).max(20).default([]),
  additionalInsuredWording: z.boolean().default(false),
  expiryWarningDays: z.number().int().min(0).max(365).default(30),
});

export type Requirements = z.infer<typeof RequirementsSchema>;

/** A name that goes into email subjects and bodies: one line, no control characters. */
export const SingleLineText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\p{Cc}]*$/u, 'Must be a single line of text.');

export const EmailAddress = z.string().trim().pipe(z.email().max(254));

export const DEFAULT_REQUIREMENTS: Requirements = RequirementsSchema.parse(defaultTemplate);
