import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RootLayout from '../app/layout';
import { Landing } from '../app/landing';
import Home from '../app/page';
import PrivacyPage from '../app/privacy/page';
import TermsPage from '../app/terms/page';
import { PRICE_PER_MONTH_USD, siteConfig } from '../lib/site';

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Server-rendered HTML without React's text-node separators. */
const html = (element: React.ReactElement) => renderToString(element).replace(/<!-- -->/g, '');
const CHECKOUT = 'https://buy.stripe.com/example-link';

describe('landing page', () => {
  const page = html(<Landing checkoutUrl={null} />);

  it('leads with an upload-a-certificate call to action that opens the checker', () => {
    expect(page).toMatch(/<a[^>]*href="\/check"[^>]*>Check a certificate free<\/a>/);
    expect(page).toContain('<h1');
    expect(page).toMatch(/certificate of insurance/i);
  });

  it('shows a sample verdict produced by the real rules, with plain-English reasons', () => {
    expect(page).toContain('below the required $1,000,000');
    expect(page).toContain('additional insured endorsement missing: CG 20 37');
    expect(page).toContain('Fail');
  });

  it('explains what is checked and links to the vendor dashboard', () => {
    expect(page).toContain('additional insured');
    expect(page).toContain('href="/dashboard"');
    expect(page).toMatch(/30, 14 and 3 days/);
  });

  it('shows the price, free during the pilot until checkout is configured', () => {
    expect(PRICE_PER_MONTH_USD).toBe(19);
    expect(page).toContain('$19');
    expect(page).toContain('per month per association');
    expect(page).toContain('Free during the pilot');
    expect(page).not.toContain('Subscribe');
  });

  it('offers checkout when a checkout link is configured', () => {
    const withCheckout = html(<Landing checkoutUrl={CHECKOUT} />);
    expect(withCheckout).toMatch(new RegExp(`<a[^>]*href="${CHECKOUT}"[^>]*>Subscribe`));
    expect(withCheckout).not.toContain('Free during the pilot');
  });

  it('reads the checkout link from CHECKOUT_URL, ignoring anything that is not https', () => {
    vi.stubEnv('CHECKOUT_URL', CHECKOUT);
    expect(html(<Home />)).toContain(`href="${CHECKOUT}"`);
    vi.stubEnv('CHECKOUT_URL', 'javascript:alert(1)');
    const unsafe = html(<Home />);
    expect(unsafe).not.toContain('javascript:');
    expect(unsafe).toContain('Free during the pilot');
  });
});

describe('siteConfig', () => {
  it.each([
    [CHECKOUT, CHECKOUT],
    ['  https://pay.example.com/covercheck  ', 'https://pay.example.com/covercheck'],
    ['http://buy.stripe.com/example-link', null],
    ['javascript:alert(1)', null],
    ['buy.stripe.com/example-link', null],
    ['', null],
    [undefined, null],
  ])('CHECKOUT_URL %j → %j', (value, expected) => {
    expect(siteConfig({ CHECKOUT_URL: value }).checkoutUrl).toBe(expected);
  });

  it.each([
    [{ CONTACT_EMAIL: 'hello@covercheck.example' }, 'hello@covercheck.example'],
    [{ CONTACT_EMAIL: 'hello@covercheck.example', EMAIL_FROM: 'covercheck <reminders@covercheck.example>' }, 'hello@covercheck.example'],
    [{ EMAIL_FROM: 'covercheck reminders <reminders@covercheck.example>' }, 'reminders@covercheck.example'],
    [{ EMAIL_FROM: 'reminders@covercheck.example' }, 'reminders@covercheck.example'],
    [{ CONTACT_EMAIL: 'not an email' }, null],
    [{ EMAIL_FROM: 'covercheck <broken>' }, null],
    [{}, null],
  ])('contact address from %o → %j', (env, expected) => {
    expect(siteConfig(env).contactEmail).toBe(expected);
  });
});

describe('legal pages', () => {
  it('terms: not proof of coverage, no advice, Stripe billing, cancelling, and the contact address', () => {
    vi.stubEnv('CONTACT_EMAIL', 'hello@covercheck.example');
    const terms = html(<TermsPage />);
    expect(terms).toContain('<h1');
    expect(terms).toContain('not proof of coverage');
    expect(terms).toMatch(/legal or insurance advice/);
    expect(terms).toContain('Stripe');
    expect(terms).toMatch(/cancel/i);
    expect(terms).toContain('href="mailto:hello@covercheck.example"');
  });

  it('privacy: what is stored, that PDFs are not, anonymous usage counts, processors and deletion', () => {
    vi.stubEnv('CONTACT_EMAIL', 'hello@covercheck.example');
    const privacy = html(<PrivacyPage />);
    expect(privacy).toContain('<h1');
    expect(privacy).toMatch(/vendor names and email addresses/i);
    expect(privacy).toMatch(/PDF is never stored/i);
    expect(privacy).toMatch(/usage counts/i);
    expect(privacy).toMatch(/no cookies/i);
    for (const processor of ['Vercel', 'Neon', 'Stripe']) expect(privacy).toContain(processor);
    expect(privacy).toMatch(/delete/i);
    expect(privacy).toContain('href="mailto:hello@covercheck.example"');
  });

  it('says how to reach covercheck even before a contact address is configured', () => {
    vi.stubEnv('CONTACT_EMAIL', '');
    vi.stubEnv('EMAIL_FROM', '');
    expect(html(<PrivacyPage />)).not.toContain('mailto:');
    expect(html(<TermsPage />)).toMatch(/contact address will be published here/i);
  });
});

describe('site layout', () => {
  it('links the brand to the landing page and every page to the terms and privacy notice', () => {
    const layout = html(
      <RootLayout>
        <p>content</p>
      </RootLayout>,
    );
    expect(layout).toMatch(/<a[^>]*class="brand"[^>]*href="\/"|<a[^>]*href="\/"[^>]*class="brand"/);
    expect(layout).toContain('href="/terms"');
    expect(layout).toContain('href="/privacy"');
  });
});
