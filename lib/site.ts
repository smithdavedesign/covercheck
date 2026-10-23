import { EmailAddress } from './schema';

export const SITE_NAME = 'covercheck';

/** The paid plan's price (REVENUE.md). It must match the Stripe Payment Link behind STRIPE_PAYMENT_LINK. */
export const PRICE_PER_MONTH_USD = 15;

/** The public repository; its issue tracker is covercheck's public contact channel. */
export const REPO_URL = 'https://github.com/smithdavedesign/covercheck';
export const ISSUES_URL = `${REPO_URL}/issues`;

/** The Vercel project's default domain, used for canonical URLs when the build doesn't say otherwise. */
export const DEFAULT_SITE_URL = 'https://covercheck.vercel.app';

export interface SiteConfig {
  /** The Stripe Payment Link from STRIPE_PAYMENT_LINK; `null` hides every Buy button. */
  paymentLink: string | null;
  /** Where boards reach covercheck privately for billing, privacy and deletion requests. */
  contactEmail: string | null;
}

type Env = Record<string, string | undefined>;

/** Only an https URL becomes a link, so a misconfigured value can't turn into `javascript:` or plain http. */
function httpsUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function emailAddress(value: string | undefined): string | null {
  const parsed = EmailAddress.safeParse(value ?? '');
  return parsed.success ? parsed.data : null;
}

/** Public settings read from the environment: STRIPE_PAYMENT_LINK, and CONTACT_EMAIL or else the address in EMAIL_FROM. */
export function siteConfig(env: Env): SiteConfig {
  const from = env.EMAIL_FROM?.trim() ?? '';
  // EMAIL_FROM is either "Name <address>" or a bare address.
  const fromAddress = /<([^<>]+)>\s*$/.exec(from)?.[1] ?? from;
  return {
    paymentLink: httpsUrl(env.STRIPE_PAYMENT_LINK),
    contactEmail: emailAddress(env.CONTACT_EMAIL) ?? emailAddress(fromAddress),
  };
}

/**
 * The site's public origin for canonical URLs, the sitemap and share tags. Vercel sets
 * VERCEL_PROJECT_PRODUCTION_URL (a bare host, the custom domain once there is one) on every build,
 * previews included, so canonical links always point at production.
 */
export function siteUrl(env: Env): string {
  const host = env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const url = host ? httpsUrl(`https://${host}`) : null;
  return url ? new URL(url).origin : DEFAULT_SITE_URL;
}
