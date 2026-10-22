import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'covercheck',
  description: 'Vendor insurance certificate checker for HOA and condo boards.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site">
          <Link href="/" className="brand">
            covercheck
          </Link>
          <span className="tagline">Vendor insurance certificate checker for HOA boards</span>
          <nav>
            <Link href="/check">Check a certificate</Link>
            <Link href="/dashboard">Vendor dashboard</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site">
          <nav aria-label="About covercheck">
            <Link href="/#pricing">Pricing</Link>
            <Link href="/terms">Terms</Link>
            <Link href="/privacy">Privacy</Link>
          </nav>
          <span>covercheck checks certificates against your requirements. It is not insurance or legal advice.</span>
        </footer>
      </body>
    </html>
  );
}
