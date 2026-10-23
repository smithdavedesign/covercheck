import { NO_TRACK_KEY, SIGNAL_URL } from '../../lib/beacon';
import { pageMetadata } from '../../lib/seo';
import { ISSUES_URL, siteConfig } from '../../lib/site';

export const metadata = pageMetadata({
  title: 'Privacy · covercheck',
  description:
    'What covercheck stores, what it never stores (the certificate PDF, cookies), the anonymous visit counter, and how to have your data deleted.',
  path: '/privacy',
});

const UPDATED = '2026-10-23';
const SIGNAL_HOST = new URL(SIGNAL_URL).host;

export default function PrivacyPage() {
  const { contactEmail } = siteConfig(process.env);
  const issues = <a href={ISSUES_URL}>covercheck’s GitHub issues</a>;
  const email = contactEmail ? <a href={`mailto:${contactEmail}`}>{contactEmail}</a> : null;
  return (
    <article className="legal">
      <h1>Privacy notice</h1>
      <p className="hint">Last updated {UPDATED}.</p>
      <p>
        In short: covercheck keeps only what you enter on a vendor dashboard, never keeps the certificate PDF, sets no cookies,
        and counts visits without knowing who you are.
      </p>

      <h2>What covercheck stores</h2>
      <p>Checking a single certificate stores nothing about you. A vendor dashboard stores:</p>
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
        <li>No accounts or passwords. covercheck sets no cookies and uses no advertising trackers.</li>
      </ul>

      <h2>Usage counts</h2>
      <p>
        To learn whether covercheck is useful, it keeps daily usage counts: how many certificates were uploaded and how many
        checks passed or failed. The counts hold no names, email addresses, IP addresses or certificate content.
      </p>

      <h2>Visit counter</h2>
      <p>
        covercheck’s maker uses RepoHQ to see whether anyone uses the product. Your browser sends it at most these three
        signals, each a single request to {SIGNAL_HOST}:
      </p>
      <ul>
        <li>
          <strong>visit</strong>: once per browser session, on the first page you open;
        </li>
        <li>
          <strong>activate</strong>: once per browser, the first time you check a certificate and get a verdict;
        </li>
        <li>
          <strong>checkout</strong>: when you click a Buy button.
        </li>
      </ul>
      <p>
        Each signal holds only the product name (covercheck), the signal’s name and, if you followed a link from another
        website, the address your browser reports for that page (usually just the site, such as reddit.com). Links between
        covercheck’s own pages are never sent. It carries no cookie, identifier, name, email address or anything about your
        certificates or vendors. Like any web request it reaches the server from your IP address. To send each signal only
        once, covercheck keeps a small note in your browser’s session and local storage; it never leaves your browser.
      </p>
      <p>
        Nothing is sent from automated browsers or test versions of the site. To switch the counter off in your browser, run{' '}
        <code>localStorage.setItem(&apos;{NO_TRACK_KEY}&apos;, &apos;1&apos;)</code> in the developer console on this site, or
        block site storage.
      </p>

      <h2>Why, and who processes it</h2>
      <p>
        The data is used only to show your dashboard, send the reminders you set up, keep your check log and count use. It is
        processed by Vercel (hosting), Neon (database), the email provider that sends reminders, RepoHQ (the visit counter),
        and Stripe (payments, if you buy; covercheck never sees card numbers). It is not sold or shared with anyone else.
      </p>

      <h2>Vendors and agents</h2>
      <p>
        If a board added you as a vendor, covercheck emails you only about that board’s certificate requirements and
        expiry dates. Reply to the email to reach the board, or contact us (below) to be removed.
      </p>

      <h2>Keeping and deleting data</h2>
      <p>
        Data stays until it is deleted. Removing a vendor stops reminders but keeps its check history for your board’s
        records. To delete your association and everything in it, contact us (below); we delete it within 30 days.
      </p>

      <h2>Contact</h2>
      <p>
        Open an issue on {issues}. Issues are public, so don’t post your dashboard link, email addresses or other personal
        details there; say what you need and we will arrange the rest privately.
        {email && <> For private requests you can also write to {email}.</>}
      </p>
    </article>
  );
}
