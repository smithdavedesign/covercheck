import type { Metadata } from 'next';
import { Checker } from './checker';

export const metadata: Metadata = {
  title: 'Check a certificate · covercheck',
  description: 'Check a vendor’s certificate of insurance against your HOA’s requirements.',
};

export default async function CheckPage({ searchParams }: { searchParams: Promise<{ vendor?: string | string[] }> }) {
  const { vendor } = await searchParams;
  return (
    <>
      <h1>Check a vendor’s certificate of insurance</h1>
      <p className="lede">
        Upload the vendor’s ACORD 25 certificate. covercheck reads it, shows you what it found, and checks it against
        your association’s requirements: limits, expiry, named insured, certificate holder and additional insured
        endorsements. The PDF itself is never stored. When you check a vendor from your dashboard, the verdict is saved
        to that vendor.
      </p>
      <Checker vendorId={typeof vendor === 'string' ? vendor : undefined} />
    </>
  );
}
