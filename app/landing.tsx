import { DISCLAIMER, check } from '../lib/check';
import { REMINDER_WINDOWS } from '../lib/email';
import { DEFAULT_REQUIREMENTS } from '../lib/schema';
import { PRICE_PER_MONTH_USD } from '../lib/site';
import { BuyButton } from './beacon';
import { Verdict } from './check/checker';

/**
 * A roofer's certificate run through the real rules, so the example can't drift from what the
 * checker says: the limit is too low, CG 20 37 is missing and workers' comp expires soon.
 */
const SAMPLE = {
  ...check(
    {
      namedInsured: 'Bright Roofing Co.',
      certificateHolder: 'Maple Ridge HOA, 12 Maple Ridge Drive, Springfield, IL 62702',
      generalLiability: {
        carrier: 'Hartford Casualty Insurance Company',
        policyNumber: 'GL-2210456',
        effectiveDate: '2026-04-01',
        expiryDate: '2027-04-01',
        eachOccurrence: 500_000,
        aggregate: 2_000_000,
      },
      workersComp: { carrier: 'Travelers Indemnity Company', policyNumber: 'WC-8812003', effectiveDate: '2025-11-15', expiryDate: '2026-11-15' },
      endorsements: ['CG 20 10'],
      description: 'Roof replacement, Building C. Maple Ridge HOA is additional insured per CG 20 10.',
    },
    { ...DEFAULT_REQUIREMENTS, certificateHolder: 'Maple Ridge HOA' },
    { vendorName: 'Bright Roofing', today: '2026-10-22' },
  ),
  disclaimer: DISCLAIMER,
};

const REMINDER_DAYS = `${REMINDER_WINDOWS.slice(0, -1).join(', ')} and ${REMINDER_WINDOWS.at(-1)} days`;

export function Landing({ paymentLink }: { paymentLink: string | null }) {
  return (
    <div className="landing">
      <div className="hero">
        <h1>Is that vendor’s insurance certificate actually protecting your HOA?</h1>
        <p className="lede">
          A certificate of insurance is not coverage. The expiry date, the limits, the named insured and the additional
          insured endorsement decide whether your association is protected, and they are easy to miss. Upload a vendor’s
          certificate and covercheck tells you in plain English what passes and what doesn’t.
        </p>
        <div className="actions">
          <a className="button cta" href="/check">
            Check a certificate free
          </a>
          <a className="button secondary cta" href="/dashboard">
            Track all your vendors
          </a>
        </div>
        <p className="hint">No account needed. The PDF is read once and never stored.</p>
      </div>

      <div className="sample">
        <h2>Example: a roofer’s certificate, checked</h2>
        <p className="hint">
          Bright Roofing’s ACORD 25 against a typical association template ($1M per occurrence, workers’ comp, CG 20 10 and
          CG 20 37). This is the checker’s real output.
        </p>
      </div>
      <Verdict result={SAMPLE} />

      <section aria-labelledby="how-heading">
        <h2 id="how-heading">How it works</h2>
        <ol className="steps">
          <li>
            <strong>Set your requirements once.</strong> Start from the default HOA template or enter your own limits,
            endorsements and certificate holder.
          </li>
          <li>
            <strong>Upload the vendor’s certificate.</strong> covercheck reads the PDF and shows every value it found, so you
            can confirm or correct it.
          </li>
          <li>
            <strong>Get the verdict, then stay covered.</strong> Pass or fail per requirement, each with a one-line reason.
            Add the vendor to your dashboard and covercheck emails them and their insurance agent {REMINDER_DAYS} before the
            certificate expires.
          </li>
        </ol>
      </section>

      <section aria-labelledby="checks-heading">
        <h2 id="checks-heading">What it checks</h2>
        <ul className="checks">
          <li>Expiry dates of general liability and workers’ comp, with a warning before they lapse</li>
          <li>General liability limits: each occurrence and aggregate</li>
          <li>Named insured matches the vendor you hired</li>
          <li>Your association is the certificate holder</li>
          <li>Additional insured endorsements (CG 20 10, CG 20 37) and additional insured wording</li>
        </ul>
        <p className="hint">
          Made for self-managed HOA and condo boards and small managers with 5 to 40 vendors. No vendor portal to roll out,
          and a check log (CSV) for your board minutes.
        </p>
      </section>

      <section id="pricing" aria-labelledby="pricing-heading" className="pricing">
        <h2 id="pricing-heading">Pricing</h2>
        <p className="price">
          <strong>${PRICE_PER_MONTH_USD}</strong> per month per association
        </p>
        <ul>
          <li>Up to 100 vendors on your dashboard</li>
          <li>Unlimited certificate checks</li>
          <li>Reminder emails to vendors and their agents</li>
          <li>Check log (CSV) for board minutes</li>
        </ul>
        {paymentLink ? (
          <>
            <BuyButton href={paymentLink} className="button cta">
              Buy for ${PRICE_PER_MONTH_USD}/month
            </BuyButton>
            <p className="hint">
              Secure checkout by Stripe. Cancel any time. See the <a href="/terms">terms</a>.
            </p>
          </>
        ) : (
          <p>
            <strong>Free during the pilot.</strong> No card needed while covercheck is tested with its first boards.
          </p>
        )}
        <p className="hint">Checking a single certificate is always free.</p>
      </section>

      <p className="disclaimer">{DISCLAIMER}</p>
    </div>
  );
}
