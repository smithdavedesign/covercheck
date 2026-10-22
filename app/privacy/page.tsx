import type { Metadata } from 'next';
import { siteConfig } from '../../lib/site';

export const metadata: Metadata = {
  title: 'Privacy · covercheck',
  description: 'What covercheck stores, what it never stores, and how to have your data deleted.',
};

const UPDATED = '2026-10-22';

export default function PrivacyPage() {
  const { contactEmail } = siteConfig(process.env);
  const contact = contactEmail ? <a href={`mailto:${contactEmail}`}>{contactEmail}</a> : 'the contact address on our terms page';
  return (
    <article className="legal">
      <h1>Privacy notice</h1>
      <p className="hint">Last updated {UPDATED}.</p>

      <h2>What covercheck stores</h2>
      <ul>
        <li>Your association’s name, the board contact email vendors reply to, and your certificate requirements.</li>
        <li>Your vendor names and email addresses: the vendor’s contact and, if you give it, their insurance agent.</li>
        <li>
          For each check you save to a vendor: the date, the verdict, the reason for each requirement (which can quote the
          named insured or certificate holder from the certificate) and the certificate’s expiry date.
        </li>
        <li>A log of the reminder emails sent: to whom and when.</li>
      </ul>

      <h2>What it never stores</h2>
      <ul>
        <li>The certificate PDF is never stored. It is read in memory to fill in the form and then discarded.</li>
        <li>
          Nothing from the checker when you use it without a dashboard: the verdict is shown to you and not kept (it is
          only counted, see below).
        </li>
        <li>No accounts or passwords. covercheck sets no cookies and uses no analytics or advertising trackers.</li>
      </ul>

      <h2>Usage counts</h2>
      <p>
        To learn whether covercheck is useful, it keeps daily usage counts: how many certificates were uploaded and how many
        checks passed or failed. The counts hold no names, email addresses, IP addresses or certificate content.
      </p>

      <h2>Why, and who processes it</h2>
      <p>
        The data is used only to show your dashboard, send the reminders you set up, and keep your check log. It is processed
        by Vercel (hosting), Neon (database), the email provider that sends reminders, and Stripe (payments, if you
        subscribe; covercheck never sees card numbers). It is not sold or shared with anyone else.
      </p>

      <h2>Vendors and agents</h2>
      <p>
        If a board added you as a vendor, covercheck emails you only about that board’s certificate requirements and
        expiry dates. Reply to the email to reach the board, or contact us at {contact} to be removed.
      </p>

      <h2>Keeping and deleting data</h2>
      <p>
        Data stays until it is deleted. Removing a vendor stops reminders but keeps its check history for your board’s
        records. To delete your association and everything in it, write to {contact} from your board contact email; we
        delete it within 30 days.
      </p>
    </article>
  );
}
