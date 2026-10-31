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
const PAYMENT_LINK = 'https://buy.stripe.com/example-link';

describe('landing page', () => {
  const page = html(<Landing paymentLink={null} />);

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

  it('shows the REVENUE.md price, free during the pilot until a payment link is configured', () => {
    expect(PRICE_PER_MONTH_USD).toBe(15);
    expect(page).toContain('$15');
    expect(page).toContain('per month per association');
    expect(page).toContain('Free during the pilot');
    expect(page).not.toMatch(/>Buy/);
  });

  it('offers a Buy button when a payment link is configured', () => {
    const withLink = html(<Landing paymentLink={PAYMENT_LINK} />);
    expect(withLink).toMatch(new RegExp(`<a[^>]*href="${PAYMENT_LINK}"[^>]*>Buy for \\$15/month`));
    expect(withLink).not.toContain('Free during the pilot');
  });

  it('reads the payment link from STRIPE_PAYMENT_LINK, ignoring anything that is not https', () => {
    vi.stubEnv('STRIPE_PAYMENT_LINK', PAYMENT_LINK);
    expect(html(<Home />)).toContain(`href="${PAYMENT_LINK}"`);
    vi.stubEnv('STRIPE_PAYMENT_LINK', 'javascript:alert(1)');
    const unsafe = html(<Home />);
    expect(unsafe).not.toContain('javascript:');
    expect(unsafe).toContain('Free during the pilot');
  });
});

describe('siteConfig', () => {
  it.each([
    [PAYMENT_LINK, PAYMENT_LINK],
    ['  https://pay.example.com/covercheck  ', 'https://pay.example.com/covercheck'],
    ['http://buy.stripe.com/example-link', null],
    ['javascript:alert(1)', null],
    ['buy.stripe.com/example-link', null],
    ['', null],
    [undefined, null],
  ])('STRIPE_PAYMENT_LINK %j → %j', (value, expected) => {
    expect(siteConfig({ STRIPE_PAYMENT_LINK: value }).paymentLink).toBe(expected);
  });

  it('ignores the old CHECKOUT_URL name', () => {
    expect(siteConfig({ CHECKOUT_URL: PAYMENT_LINK }).paymentLink).toBeNull();
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
  it('terms: not proof of coverage, no advice, no warranty, the price, Stripe billing, cancelling, refunds and contact', () => {
    vi.stubEnv('CONTACT_EMAIL', 'hello@covercheck.example');
    const terms = html(<TermsPage />);
    expect(terms).toContain('<h1');
    expect(terms).toContain('not proof of coverage');
    expect(terms).toMatch(/legal or insurance advice/);
    expect(terms).toMatch(/without warranty of any kind/);
    expect(terms).toContain('$15 per month per association');
    expect(terms).toContain('Stripe');
    expect(terms).toMatch(/cancel any time/i);
    expect(terms).toMatch(/within 14 days of a charge, we refund that month/);
    expect(terms).toContain('href="https://github.com/smithdavedesign/covercheck/issues"');
    expect(terms).toContain('href="mailto:hello@covercheck.example"');
  });

  it('privacy: what is stored, that PDFs are not, no cookies, usage counts, processors and deletion', () => {
    vi.stubEnv('CONTACT_EMAIL', 'hello@covercheck.example');
    const privacy = html(<PrivacyPage />);
    expect(privacy).toContain('<h1');
    expect(privacy).toMatch(/vendor names and email addresses/i);
    expect(privacy).toMatch(/PDF is never stored/i);
    expect(privacy).toMatch(/usage counts/i);
    expect(privacy).toMatch(/sets no cookies/i);
    for (const processor of ['Vercel', 'Neon', 'Stripe', 'RepoHQ']) expect(privacy).toContain(processor);
    expect(privacy).toMatch(/delete/i);
    expect(privacy).toContain('href="mailto:hello@covercheck.example"');
  });

  it('privacy: names the three visit-counter signals, what they carry and how to switch them off', () => {
    const privacy = html(<PrivacyPage />);
    for (const kind of ['visit', 'activate', 'checkout']) expect(privacy).toContain(`<strong>${kind}</strong>`);
    expect(privacy).toContain('idea-factory.1426davejobs.workers.dev');
    expect(privacy).toMatch(/no cookie, identifier/);
    expect(privacy).toContain('repohq:notrack');
  });

  it('both point to GitHub issues for contact, even before a contact address is configured', () => {
    vi.stubEnv('CONTACT_EMAIL', '');
    vi.stubEnv('EMAIL_FROM', '');
    for (const page of [html(<PrivacyPage />), html(<TermsPage />)]) {
      expect(page).not.toContain('mailto:');
      expect(page).toContain('href="https://github.com/smithdavedesign/covercheck/issues"');
    }
  });
});

describe('site layout', () => {
  const layout = () =>
    html(
      <RootLayout>
        <p>content</p>
      </RootLayout>,
    );

  it('links the brand to the landing page and every page to the terms and privacy notice', () => {
    const page = layout();
    expect(page).toMatch(/<a[^>]*class="brand"[^>]*href="\/"|<a[^>]*href="\/"[^>]*class="brand"/);
    expect(page).toMatch(/<footer[\s\S]*href="\/terms"[\s\S]*<\/footer>/);
    expect(page).toMatch(/<footer[\s\S]*href="\/privacy"[\s\S]*<\/footer>/);
  });

  it('hides the header Buy button without STRIPE_PAYMENT_LINK and shows it with one', () => {
    vi.stubEnv('STRIPE_PAYMENT_LINK', '');
    expect(layout()).not.toMatch(/>Buy/);
    vi.stubEnv('STRIPE_PAYMENT_LINK', PAYMENT_LINK);
    expect(layout()).toMatch(new RegExp(`<a[^>]*href="${PAYMENT_LINK}"[^>]*>Buy · \\$15/mo</a>`));
  });
});
