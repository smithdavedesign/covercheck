/**
 * The RepoHQ visit beacon: how covercheck's maker counts real use. Three events, each a small JSON POST
 * (fire-and-forget, no cookies, no identifier):
 *
 *   visit     the first page of a browser session      once per session  (sessionStorage)
 *   activate  the first certificate verdict            once per browser  (localStorage)
 *   checkout  a click on a Buy button                  every click
 *
 * Nothing is sent outside Vercel production, from automated browsers (navigator.webdriver), when the
 * browser has localStorage "repohq:notrack" set (the owner's own browser), or when storage is blocked.
 * The privacy page describes exactly this; change both together.
 */
export const SIGNAL_URL = 'https://idea-factory.1426davejobs.workers.dev/api/ideas/signal';
export const SIGNAL_SLUG = 'covercheck';
export const NO_TRACK_KEY = 'repohq:notrack';

export type SignalKind = 'visit' | 'activate' | 'checkout';

/** Where a once-only event remembers that it was sent. */
export const ONCE: Partial<Record<SignalKind, { storage: 'sessionStorage' | 'localStorage'; key: string }>> = {
  visit: { storage: 'sessionStorage', key: 'repohq:covercheck:visit' },
  activate: { storage: 'localStorage', key: 'repohq:covercheck:activate' },
};

/** The referring page only when it is another site, so covercheck's own URLs (and share links) never leave the page. */
export function externalReferrer(referrer: string, origin: string): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).origin !== origin ? referrer : null;
  } catch {
    return null;
  }
}

function trackingAllowed(): boolean {
  // Written out in full so Next.js inlines it into the browser bundle at build time.
  if (process.env.NEXT_PUBLIC_VERCEL_ENV !== 'production') return false;
  if (typeof window === 'undefined' || navigator.webdriver) return false;
  return window.localStorage.getItem(NO_TRACK_KEY) === null;
}

/** Sends one event to RepoHQ if allowed. Never throws and never waits: counting must not affect the page. */
export function signal(kind: SignalKind): void {
  try {
    if (!trackingAllowed()) return;
    const once = ONCE[kind];
    if (once) {
      const storage = window[once.storage];
      if (storage.getItem(once.key) !== null) return;
      storage.setItem(once.key, new Date().toISOString().slice(0, 10));
    }
    fetch(SIGNAL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: SIGNAL_SLUG, kind, referrer: externalReferrer(document.referrer, window.location.origin) }),
      keepalive: true, // survives the navigation to Stripe after a Buy click
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    }).catch(() => {});
  } catch {
    // Storage blocked (some private modes) or no fetch: count nothing.
  }
}
