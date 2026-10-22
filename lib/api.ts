import { createHash, timingSafeEqual } from 'node:crypto';
import type { z } from 'zod';
import { daysBetween, isoToday } from './check';
import type { Db } from './db';
import { associationForKey, type Association } from './store';

/** JSON request bodies are small: confirmed certificate fields at most. */
const MAX_BODY_CHARS = 100_000;
/** The board's local date may differ from the server's UTC date by up to a day. */
const MAX_AS_OF_DRIFT_DAYS = 1;

/** Thrown inside a route handler to answer with a JSON error. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: object = {},
  ) {
    super(message);
  }
}

function jsonError(status: number, code: string, message: string, extra: object = {}): Response {
  return Response.json({ error: code, message, ...extra }, { status });
}

/** Wraps a route handler so a thrown {@link HttpError} becomes its JSON response. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof HttpError) return jsonError(error.status, error.code, error.message, error.extra);
      throw error;
    }
  };
}

export async function readJson(request: Request, maxChars = MAX_BODY_CHARS): Promise<unknown> {
  const tooLarge = () => new HttpError(413, 'too_large', 'Request body is too large.');
  if (Number(request.headers.get('content-length') ?? 0) > maxChars) throw tooLarge();
  const raw = await request.text();
  if (raw.length > maxChars) throw tooLarge();
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body must be JSON.');
  }
}

export function parse<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
    throw new HttpError(400, 'invalid_request', 'Some fields are missing or malformed.', { issues });
  }
  return parsed.data;
}

/** The date to check against: the board's local date when it is within a day of the server's, else an error. */
export function resolveAsOf(asOf: string | undefined): string {
  const serverToday = isoToday();
  if (asOf && Math.abs(daysBetween(serverToday, asOf)) > MAX_AS_OF_DRIFT_DAYS) {
    throw new HttpError(400, 'invalid_as_of', 'asOf must be today’s date.');
  }
  return asOf ?? serverToday;
}

/** Constant-time comparison of two header values of any length. */
function sameSecret(a: string, b: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

/**
 * Lets the request through only with `Authorization: Bearer <secret>` for an operator secret from the env.
 * Fails closed: without a configured secret, "Bearer undefined" must not get in.
 */
export function requireBearerSecret(request: Request, secret: string | undefined, notConfigured: { code: string; message: string }): void {
  if (!secret) throw new HttpError(503, notConfigured.code, notConfigured.message);
  if (!sameSecret(request.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    throw new HttpError(401, 'unauthorized', 'Not allowed.');
  }
}

/** The association whose key is in `Authorization: Bearer <key>`. */
export async function requireAssociation(request: Request, db: Db): Promise<Association> {
  const match = /^Bearer (\S+)$/.exec(request.headers.get('authorization') ?? '');
  const association = match ? await associationForKey(db, match[1]) : null;
  if (!association) {
    throw new HttpError(401, 'unauthorized', 'This dashboard link is missing its key or the key is not valid. Open your private dashboard link again.');
  }
  return association;
}
