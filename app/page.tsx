import type { Metadata } from 'next';
import { siteConfig } from '../lib/site';
import { Landing } from './landing';

export const metadata: Metadata = {
  title: 'covercheck: check your vendors’ insurance certificates',
  description:
    'For HOA and condo boards: upload a vendor’s certificate of insurance and see in plain English whether the limits, expiry, named insured and additional insured endorsements protect your association.',
};

/** The landing page. CHECKOUT_URL is read at build time, so set it before deploying. */
export default function Home() {
  return <Landing checkoutUrl={siteConfig(process.env).checkoutUrl} />;
}
