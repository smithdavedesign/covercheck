import { pageMetadata } from '../lib/seo';
import { siteConfig } from '../lib/site';
import { Landing } from './landing';

export const metadata = pageMetadata({
  title: 'covercheck: check your vendors’ insurance certificates',
  description:
    'Upload a vendor’s certificate of insurance and see in plain English whether its limits, expiry and endorsements protect your HOA or condo association.',
  path: '/',
});

/** The landing page. STRIPE_PAYMENT_LINK is read at build time, so set it before deploying. */
export default function Home() {
  return <Landing paymentLink={siteConfig(process.env).paymentLink} />;
}
