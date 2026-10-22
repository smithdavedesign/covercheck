import { createHash, randomBytes } from 'node:crypto';
import { daysBetween, type CheckResult, type RuleResult } from './check';
import type { Db } from './db';
import { ccAddress, mailtoHref, requestEmail } from './email';
import { RequirementsSchema, type CoiFields, type Requirements } from './schema';

/** The PRD's largest customer has ~40 vendors; this only stops runaway lists. */
export const MAX_VENDORS_PER_ASSOCIATION = 100;

/** 32 random bytes, base64url: the only credential an association has. */
const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Associations ───────────────────────────────────────────────────────────────

export interface Association {
  id: string;
  name: string;
  /** The board member who receives vendors' replies. */
  contactEmail: string;
  requirements: Requirements;
}

export type NewAssociation = Omit<Association, 'id'>;

interface AssociationRow {
  id: string;
  name: string;
  contact_email: string;
  requirements: unknown;
}

const ASSOCIATION_COLUMNS = 'id, name, contact_email, requirements';

function toAssociation(row: AssociationRow): Association {
  return { id: row.id, name: row.name, contactEmail: row.contact_email, requirements: RequirementsSchema.parse(row.requirements) };
}

export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/** Creates an association and its access key. Only the key's hash is stored; the key is shown once. */
export async function createAssociation(db: Db, input: NewAssociation): Promise<{ association: Association; key: string }> {
  const key = randomBytes(32).toString('base64url');
  const [row] = await db.query<AssociationRow>(
    `INSERT INTO associations (name, contact_email, requirements, key_hash)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING ${ASSOCIATION_COLUMNS}`,
    [input.name, input.contactEmail, JSON.stringify(input.requirements), hashKey(key)],
  );
  return { association: toAssociation(row), key };
}

export async function associationForKey(db: Db, key: string): Promise<Association | null> {
  if (!KEY_PATTERN.test(key)) return null;
  const [row] = await db.query<AssociationRow>(`SELECT ${ASSOCIATION_COLUMNS} FROM associations WHERE key_hash = $1`, [
    hashKey(key),
  ]);
  return row ? toAssociation(row) : null;
}

// ── Vendors ────────────────────────────────────────────────────────────────────

/** A vendor and its latest saved check (all `null` until the first one). */
export interface Vendor {
  id: string;
  name: string;
  contactEmail: string;
  agentEmail: string | null;
  expiryDate: string | null;
  verdict: 'pass' | 'fail' | null;
  checkedOn: string | null;
  failedReasons: string[];
}

export type NewVendor = Pick<Vendor, 'name' | 'contactEmail' | 'agentEmail'>;

interface VendorRow {
  id: string;
  name: string;
  contact_email: string;
  agent_email: string | null;
  expiry_date: string | null;
  verdict: 'pass' | 'fail' | null;
  checked_on: string | null;
  results: RuleResult[] | null;
}

/** Each active vendor joined to its latest check. */
const VENDOR_SELECT = `
  SELECT v.id, v.name, v.contact_email, v.agent_email,
         c.expiry_date::text AS expiry_date, c.verdict, c.checked_on::text AS checked_on, c.results
  FROM vendors v
  LEFT JOIN LATERAL (
    SELECT expiry_date, verdict, checked_on, results FROM checks WHERE checks.vendor_id = v.id ORDER BY id DESC LIMIT 1
  ) c ON true
  WHERE v.removed_at IS NULL`;

function toVendor(row: VendorRow): Vendor {
  return {
    id: row.id,
    name: row.name,
    contactEmail: row.contact_email,
    agentEmail: row.agent_email,
    expiryDate: row.expiry_date,
    verdict: row.verdict,
    checkedOn: row.checked_on,
    failedReasons: (row.results ?? []).filter((result) => !result.passed).map((result) => result.reason),
  };
}

/** The dashboard list: soonest expiry first, vendors without a certificate last. */
export async function listVendors(db: Db, associationId: string): Promise<Vendor[]> {
  const rows = await db.query<VendorRow>(
    `${VENDOR_SELECT} AND v.association_id = $1
     ORDER BY c.expiry_date ASC NULLS LAST, lower(v.name), v.id`,
    [associationId],
  );
  return rows.map(toVendor);
}

export async function findVendor(db: Db, associationId: string, vendorId: string): Promise<Vendor | null> {
  if (!UUID_PATTERN.test(vendorId)) return null;
  const [row] = await db.query<VendorRow>(`${VENDOR_SELECT} AND v.association_id = $1 AND v.id = $2`, [associationId, vendorId]);
  return row ? toVendor(row) : null;
}

export type AddVendorResult = { ok: true; vendor: Vendor } | { ok: false; reason: 'duplicate' | 'limit' };

/** Adds a vendor unless an active one has the same name (any case/spacing) or the association is full. */
export async function addVendor(db: Db, associationId: string, input: NewVendor): Promise<AddVendorResult> {
  const name = input.name.trim().replace(/\s+/g, ' ');
  const contactEmail = input.contactEmail.trim();
  const agentEmail = input.agentEmail?.trim() || null;
  const [row] = await db.query<{ id: string }>(
    `INSERT INTO vendors (association_id, name, contact_email, agent_email)
     SELECT $1::uuid, $2::text, $3::text, $4::text
     WHERE (SELECT count(*) FROM vendors WHERE association_id = $1::uuid AND removed_at IS NULL) < $5::int
     ON CONFLICT (association_id, lower(name)) WHERE removed_at IS NULL DO NOTHING
     RETURNING id`,
    [associationId, name, contactEmail, agentEmail, MAX_VENDORS_PER_ASSOCIATION],
  );
  if (row) {
    const vendor = { id: row.id, name, contactEmail, agentEmail, expiryDate: null, verdict: null, checkedOn: null, failedReasons: [] };
    return { ok: true, vendor };
  }
  const duplicate = await db.query(
    'SELECT 1 FROM vendors WHERE association_id = $1 AND lower(name) = lower($2) AND removed_at IS NULL',
    [associationId, name],
  );
  return { ok: false, reason: duplicate.length ? 'duplicate' : 'limit' };
}

/** Takes the vendor off the list and out of the reminder job; its checks stay for the record. */
export async function removeVendor(db: Db, associationId: string, vendorId: string): Promise<boolean> {
  if (!UUID_PATTERN.test(vendorId)) return false;
  const rows = await db.query(
    `UPDATE vendors SET removed_at = now()
     WHERE id = $1 AND association_id = $2 AND removed_at IS NULL
     RETURNING id`,
    [vendorId, associationId],
  );
  return rows.length > 0;
}

// ── Checks ─────────────────────────────────────────────────────────────────────

export interface SavedCheck {
  checkedOn: string;
  verdict: CheckResult['verdict'];
  /** The certificate's effective expiry, see {@link certificateExpiry}. */
  expiryDate: string | null;
  results: RuleResult[];
}

/** Appends a check; the newest check is the vendor's current status. */
export async function recordCheck(db: Db, vendorId: string, check: SavedCheck): Promise<void> {
  await db.query(
    `INSERT INTO checks (vendor_id, checked_on, verdict, expiry_date, results)
     VALUES ($1, $2::date, $3, $4::date, $5::jsonb)`,
    [vendorId, check.checkedOn, check.verdict, check.expiryDate, JSON.stringify(check.results)],
  );
}

/** One saved check in the board's log (the CSV export). */
export interface CheckLogEntry {
  checkedOn: string;
  vendorName: string;
  verdict: CheckResult['verdict'];
  expiryDate: string | null;
  failed: { label: string; reason: string }[];
}

/** Every check saved for the association's vendors, removed ones included, oldest first. */
export async function listChecks(db: Db, associationId: string): Promise<CheckLogEntry[]> {
  const rows = await db.query<{
    checked_on: string;
    vendor_name: string;
    verdict: CheckResult['verdict'];
    expiry_date: string | null;
    results: RuleResult[];
  }>(
    `SELECT c.checked_on::text AS checked_on, v.name AS vendor_name, c.verdict, c.expiry_date::text AS expiry_date, c.results
     FROM checks c
     JOIN vendors v ON v.id = c.vendor_id
     WHERE v.association_id = $1
     ORDER BY c.checked_on, c.id`,
    [associationId],
  );
  return rows.map((row) => ({
    checkedOn: row.checked_on,
    vendorName: row.vendor_name,
    verdict: row.verdict,
    expiryDate: row.expiry_date,
    failed: row.results.filter((result) => !result.passed).map(({ label, reason }) => ({ label, reason })),
  }));
}

/**
 * When the certificate stops protecting the association: the earlier of the general liability
 * expiry and, if the association requires it, the workers' comp expiry.
 */
export function certificateExpiry(fields: CoiFields, requirements: Requirements): string | null {
  const dates = [
    fields.generalLiability.expiryDate,
    requirements.workersCompRequired ? (fields.workersComp?.expiryDate ?? null) : null,
  ].filter((date): date is string => date !== null);
  return dates.sort()[0] ?? null;
}

// ── Dashboard view ─────────────────────────────────────────────────────────────

export type VendorStatus = 'no_certificate' | 'expired' | 'not_compliant' | 'expiring' | 'ok';

const STATUS_LABELS: Record<VendorStatus, string> = {
  no_certificate: 'No certificate',
  expired: 'Expired',
  not_compliant: 'Not compliant',
  expiring: 'Expires soon',
  ok: 'OK',
};

/** Status on `today`: expiry is re-evaluated daily, so a certificate that passed can expire later. */
export function vendorStatus(vendor: Pick<Vendor, 'verdict' | 'expiryDate'>, today: string, warnDays: number): VendorStatus {
  if (vendor.verdict === null) return 'no_certificate';
  const daysLeft = vendor.expiryDate ? daysBetween(today, vendor.expiryDate) : null;
  // Coverage ends at 12:01 AM on the expiration date, so that day already counts as expired.
  if (daysLeft !== null && daysLeft <= 0) return 'expired';
  if (vendor.verdict === 'fail' || daysLeft === null) return 'not_compliant';
  return daysLeft <= warnDays ? 'expiring' : 'ok';
}

export interface VendorView extends Vendor {
  status: VendorStatus;
  statusLabel: string;
  daysLeft: number | null;
  /** A `mailto:` link with the "request updated certificate" email ready to send. */
  requestHref: string;
}

export function vendorView(vendor: Vendor, association: Association, today: string): VendorView {
  const status = vendorStatus(vendor, today, association.requirements.expiryWarningDays);
  const email = requestEmail({
    vendorName: vendor.name,
    associationName: association.name,
    requirements: association.requirements,
    today,
    checkedOn: vendor.checkedOn,
    expiryDate: vendor.expiryDate,
    failedReasons: vendor.failedReasons,
  });
  return {
    ...vendor,
    status,
    statusLabel: STATUS_LABELS[status],
    daysLeft: vendor.expiryDate ? daysBetween(today, vendor.expiryDate) : null,
    requestHref: mailtoHref({
      to: vendor.contactEmail,
      cc: ccAddress(vendor.contactEmail, vendor.agentEmail),
      subject: email.subject,
      body: email.text,
    }),
  };
}
