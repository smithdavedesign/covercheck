import { PGlite } from '@electric-sql/pglite';
import { migrate, pgliteDb, type Db } from '../../lib/db';
import type { Email, Mailer } from '../../lib/reminders';
import { DEFAULT_REQUIREMENTS, type Requirements } from '../../lib/schema';
import { addVendor, createAssociation, recordCheck, type NewVendor, type Vendor } from '../../lib/store';
import { TODAY } from './fixtures';

export interface TestDb {
  db: Db;
  /** Empties every table between tests. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/** A fresh in-memory Postgres (PGlite) with the production schema. */
export async function testDb(): Promise<TestDb> {
  const pg = new PGlite();
  const db = pgliteDb(pg);
  await migrate(db);
  return {
    db,
    reset: async () => {
      await pg.exec('TRUNCATE associations, vendors, checks, reminders, usage_counts CASCADE');
    },
    close: () => pg.close(),
  };
}

export interface Outbox extends Mailer {
  sent: Email[];
  /** Emails to these addresses throw instead of being sent. */
  failFor: Set<string>;
}

/** An in-memory mailer that records what would have been sent. */
export function outbox(): Outbox {
  const box: Outbox = {
    sent: [],
    failFor: new Set(),
    async send(email) {
      if (box.failFor.has(email.to)) throw new Error('SMTP server unavailable');
      box.sent.push(email);
    },
  };
  return box;
}

export async function seedAssociation(db: Db, patch: { name?: string; contactEmail?: string; requirements?: Requirements } = {}) {
  return createAssociation(db, {
    name: patch.name ?? 'Maple Ridge HOA',
    contactEmail: patch.contactEmail ?? 'treasurer@mapleridge.example',
    requirements: patch.requirements ?? { ...DEFAULT_REQUIREMENTS, certificateHolder: patch.name ?? 'Maple Ridge HOA' },
  });
}

export async function seedVendor(db: Db, associationId: string, patch: Partial<NewVendor> = {}): Promise<Vendor> {
  const slug = (patch.name ?? 'Acme Landscaping').toLowerCase().replace(/[^a-z]+/g, '');
  const result = await addVendor(db, associationId, {
    name: patch.name ?? 'Acme Landscaping',
    contactEmail: patch.contactEmail ?? `office@${slug}.example`,
    agentEmail: patch.agentEmail === undefined ? `certs@agent-${slug}.example` : patch.agentEmail,
  });
  if (!result.ok) throw new Error(`could not seed vendor: ${result.reason}`);
  return result.vendor;
}

/** Records a check for the vendor whose certificate expires on `expiryDate`. */
export async function seedCheck(
  db: Db,
  vendorId: string,
  expiryDate: string | null,
  patch: { verdict?: 'pass' | 'fail'; checkedOn?: string; failedReasons?: string[] } = {},
) {
  const failed = patch.failedReasons ?? [];
  await recordCheck(db, vendorId, {
    checkedOn: patch.checkedOn ?? TODAY,
    verdict: patch.verdict ?? (failed.length ? 'fail' : 'pass'),
    expiryDate,
    results: [
      { rule: 'gl_expiry', label: 'General liability expiry', passed: true, reason: `general liability policy in force until ${expiryDate}` },
      ...failed.map((reason) => ({ rule: 'gl_each_occurrence' as const, label: 'General liability each occurrence', passed: false, reason })),
    ],
  });
}
