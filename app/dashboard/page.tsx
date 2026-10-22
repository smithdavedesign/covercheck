import type { Metadata } from 'next';
import { Dashboard } from './dashboard';

export const metadata: Metadata = {
  title: 'Vendor dashboard · covercheck',
  description: 'Every vendor’s certificate status and expiry, with automatic reminders before coverage lapses.',
  // The page is reached through private links; keep it out of search results.
  robots: { index: false, follow: false },
};

export default function DashboardPage() {
  return (
    <>
      <h1>Vendor dashboard</h1>
      <p className="lede">
        Keep every vendor’s certificate of insurance current. covercheck shows who is covered and who isn’t, and reminds
        vendors and their agents before a certificate expires.
      </p>
      <Dashboard />
    </>
  );
}
