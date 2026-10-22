import { EmailAddress } from './schema';

/** The paid plan's price. It must match the Stripe Payment Link behind CHECKOUT_URL. */
export const PRICE_PER_MONTH_USD = 19;

export interface SiteConfig {
  /** A hosted checkout page (a Stripe Payment Link); `null` hides the Subscribe button. */
  checkoutUrl: string | null;
  /** Where boards reach covercheck for billing, privacy and deletion requests. */
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

/** Public settings read from the environment: CHECKOUT_URL, and CONTACT_EMAIL or else the address in EMAIL_FROM. */
export function siteConfig(env: Env): SiteConfig {
  const from = env.EMAIL_FROM?.trim() ?? '';
  // EMAIL_FROM is either "Name <address>" or a bare address.
  const fromAddress = /<([^<>]+)>\s*$/.exec(from)?.[1] ?? from;
  return {
    checkoutUrl: httpsUrl(env.CHECKOUT_URL),
    contactEmail: emailAddress(env.CONTACT_EMAIL) ?? emailAddress(fromAddress),
  };
}
