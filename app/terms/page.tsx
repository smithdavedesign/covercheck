import type { Metadata } from 'next';
import { DISCLAIMER } from '../../lib/check';
import { PRICE_PER_MONTH_USD, siteConfig } from '../../lib/site';

export const metadata: Metadata = {
  title: 'Terms · covercheck',
  description: 'The terms for using covercheck and for the paid plan.',
};

const UPDATED = '2026-10-22';

export default function TermsPage() {
  const { contactEmail } = siteConfig(process.env);
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

      <h2>Paid plan and billing</h2>
      <p>
        The paid plan is ${PRICE_PER_MONTH_USD} per month per association, billed monthly by Stripe. You can cancel any time
        by emailing us; the subscription then ends at the close of the current month. If you ask within 14 days of a charge,
        we refund that month. During the pilot every feature stays available whether or not you subscribe, and we will give
        30 days’ notice by email before any change to the price or to what is included.
      </p>

      <h2>Availability and liability</h2>
      <p>
        covercheck runs on free hosting tiers and is provided as is, without an uptime guarantee; a reminder can arrive a day
        late. To the extent the law allows, our liability is limited to what you paid us in the 12 months before a claim.
      </p>

      <h2>Contact</h2>
      <p>
        {contactEmail ? (
          <>
            Questions, cancellations and refunds: <a href={`mailto:${contactEmail}`}>{contactEmail}</a>.
          </>
        ) : (
          'The contact address will be published here before paid plans start.'
        )}
      </p>
    </article>
  );
}
