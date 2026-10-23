import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { jsonLdScript, softwareApplicationJsonLd } from '../lib/seo';
import { PRICE_PER_MONTH_USD, SITE_NAME, siteConfig, siteUrl } from '../lib/site';
import { BuyButton, VisitBeacon } from './beacon';
import './globals.css';

const DESCRIPTION = 'Vendor insurance certificate checker for HOA and condo boards.';

/** Defaults for any page that sets nothing itself; every public page sets its own through `pageMetadata`. */
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl(process.env)),
  title: SITE_NAME,
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  openGraph: { type: 'website', siteName: SITE_NAME, locale: 'en_US', title: SITE_NAME, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: SITE_NAME, description: DESCRIPTION },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const { paymentLink } = siteConfig(process.env);
  return (
    <html lang="en">
      <body>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScript(softwareApplicationJsonLd(siteUrl(process.env))) }} />
        <VisitBeacon />
        <header className="site">
          <Link href="/" className="brand">
            covercheck
          </Link>
          <span className="tagline">Vendor insurance certificate checker for HOA boards</span>
          <nav>
            <Link href="/check">Check a certificate</Link>
            <Link href="/dashboard">Vendor dashboard</Link>
          </nav>
          <BuyButton href={paymentLink} className="button buy">
            Buy · ${PRICE_PER_MONTH_USD}/mo
          </BuyButton>
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
