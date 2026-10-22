import { isoToday } from './check';
import { getDb, type Db } from './db';

/**
 * What the demand test counts: `upload` is a certificate file received by /api/extract (read or
 * not); `pass` / `fail` is each verdict returned by a check. Re-checking after an edit counts again.
 */
export const USAGE_KINDS = ['upload', 'pass', 'fail'] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export interface UsageDay {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  uploads: number;
  passes: number;
  fails: number;
}

export interface UsageCounts {
  uploads: number;
  passes: number;
  fails: number;
  /** Days with any usage, oldest first. */
  days: UsageDay[];
}

/** Adds one to the day's counter in a single atomic upsert, so concurrent requests never lose a count. */
export async function recordUsage(db: Db, kind: UsageKind, day: string): Promise<void> {
  await db.query(
    `INSERT INTO usage_counts (day, kind, count) VALUES ($1::date, $2, 1)
     ON CONFLICT (day, kind) DO UPDATE SET count = usage_counts.count + 1`,
    [day, kind],
  );
}

/** Longest an upload or check waits for its count: a slow or hung database must not slow down the user. */
export const USAGE_TIMEOUT_MS = 2_000;

/**
 * Counts one use on today's UTC date. Best-effort: a counting failure never fails the request being
 * counted, and a slow database delays it by at most {@link USAGE_TIMEOUT_MS} (that count may then be lost).
 */
export async function trackUsage(kind: UsageKind): Promise<void> {
  const counted = (async () => recordUsage(await getDb(), kind, isoToday()))();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const tooSlow = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('usage count timed out'), { name: 'TimeoutError' })), USAGE_TIMEOUT_MS);
  });
  try {
    await Promise.race([counted, tooSlow]);
  } catch (error) {
    // A count that fails after timing out was already reported as the timeout.
    counted.catch(() => {});
    // The error's name only: messages can carry connection details.
    console.error('covercheck: usage not recorded', { kind, error: error instanceof Error ? error.name : 'unknown' });
  } finally {
    clearTimeout(timer);
  }
}

export async function usageCounts(db: Db): Promise<UsageCounts> {
  const days = await db.query<UsageDay>(
    `SELECT day::text AS date,
            coalesce(sum(count) FILTER (WHERE kind = 'upload'), 0)::int AS uploads,
            coalesce(sum(count) FILTER (WHERE kind = 'pass'), 0)::int AS passes,
            coalesce(sum(count) FILTER (WHERE kind = 'fail'), 0)::int AS fails
     FROM usage_counts
     GROUP BY day
     ORDER BY day`,
  );
  const total = (key: 'uploads' | 'passes' | 'fails') => days.reduce((sum, day) => sum + day[key], 0);
  return { uploads: total('uploads'), passes: total('passes'), fails: total('fails'), days };
}
