import { DISCLAIMER } from '../../lib/check';
import { pageMetadata } from '../../lib/seo';
import { ISSUES_URL, PRICE_PER_MONTH_USD, siteConfig } from '../../lib/site';

export const metadata = pageMetadata({
  title: 'Terms · covercheck',
  description: `The terms for using covercheck: a checklist, not advice; no warranty; and the $${PRICE_PER_MONTH_USD}/month plan, cancelling and refunds.`,
  path: '/terms',
});

const UPDATED = '2026-10-23';

export default function TermsPage() {
  const { contactEmail } = siteConfig(process.env);
  const issues = <a href={ISSUES_URL}>covercheck’s GitHub issues</a>;
  return (
    <article className="legal">
      <h1>Terms of use</h1>
      <p className="hint">Last updated {UPDATED}. Plain English, short on purpose.</p>

      <h2>What covercheck does</h2>
      <p>
        covercheck reads a vendor’s certificate of insurance, compares it with the requirements your association sets, and
        shows a pass or fail for each requirement. If you add vendors to a dashboard, covercheck emails them and their
        insurance agent before their certificate expires, on your association’s behalf.
      </p>

      <h2>It is a checklist, not advice</h2>
      <p>{DISCLAIMER}</p>
      <p>
        covercheck can misread a certificate. You confirm every value it reads before relying on a verdict, and your board
        decides whether a vendor is adequately insured.
      </p>

      <h2>Your part</h2>
      <ul>
        <li>Add only vendors your association works with, with addresses they gave you.</li>
        <li>
          Keep your private dashboard link private. Anyone with the link can see and change your vendor list, and there is no
          password to reset.
        </li>
      </ul>

      <h2>Price, cancelling and refunds</h2>
      <p>
        Checking a single certificate is free. The paid plan is ${PRICE_PER_MONTH_USD} per month per association, billed
        monthly by Stripe. You can cancel any time; the subscription then ends at the close of the current month. If you ask
        within 14 days of a charge, we refund that month. During the pilot every feature stays available whether or not you
        pay, and we will give 30 days’ notice by email before any change to the price or to what is included.
      </p>

      <h2>No warranty</h2>
      <p>
        covercheck is provided “as is” and “as available”, without warranty of any kind, express or implied, including
        fitness for a particular purpose and accuracy of any verdict. It runs on free hosting tiers without an uptime
        guarantee, and a reminder can arrive late or not at all. To the extent the law allows, our liability is limited to
        what you paid us in the 12 months before a claim.
      </p>

      <h2>Contact</h2>
      <p>
        Questions, cancellations and refunds: open an issue on {issues} (it is public, so leave out payment and personal
        details)
        {contactEmail ? (
          <>
            , or write to <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
          </>
        ) : (
          '.'
        )}
      </p>
    </article>
  );
}
