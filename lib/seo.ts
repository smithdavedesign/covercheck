import type { Metadata } from 'next';
import { PRICE_PER_MONTH_USD, SITE_NAME } from './site';

/** The pages search engines may index, in sitemap order. The dashboard is reached through private links and stays out. */
export const PUBLIC_PATHS = ['/', '/check', '/privacy', '/terms'] as const;

/** The link-preview image drawn by app/share-image.tsx and served at /opengraph-image and /twitter-image. */
export const SHARE_IMAGE_SIZE = { width: 1200, height: 630 };
export const SHARE_IMAGE_TYPE = 'image/png';
export const SHARE_IMAGE_ALT =
  'covercheck: a vendor’s insurance certificate checked against an HOA’s requirements, with a plain-English reason for each failure.';

const shareImageTags = (url: string) => ({ url, ...SHARE_IMAGE_SIZE, type: SHARE_IMAGE_TYPE, alt: SHARE_IMAGE_ALT });

/**
 * A page's title, description, canonical URL and share tags. Next merges metadata shallowly, so a page that
 * sets `openGraph` loses the root segment's file-based image; each page therefore names the image routes
 * itself. Relative URLs resolve against the layout's `metadataBase`.
 */
export function pageMetadata({ title, description, path }: { title: string; description: string; path: string }): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: { type: 'website', siteName: SITE_NAME, locale: 'en_US', url: path, title, description, images: [shareImageTags('/opengraph-image')] },
    twitter: { card: 'summary_large_image', title, description, images: [shareImageTags('/twitter-image')] },
  };
}

/** schema.org description of covercheck and its paid plan, for search results. */
export function softwareApplicationJsonLd(siteUrl: string) {
  const price = PRICE_PER_MONTH_USD.toFixed(2);
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE_NAME,
    url: `${siteUrl}/`,
    description:
      'Checks a vendor’s certificate of insurance against an HOA or condo association’s requirements (limits, expiry, named insured, additional insured endorsements) and reminds vendors before coverage lapses.',
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    offers: {
      '@type': 'Offer',
      price,
      priceCurrency: 'USD',
      url: `${siteUrl}/#pricing`,
      priceSpecification: {
        '@type': 'UnitPriceSpecification',
        price,
        priceCurrency: 'USD',
        unitText: 'month',
        referenceQuantity: { '@type': 'QuantitativeValue', value: 1, unitCode: 'MON' },
      },
    },
  };
}

/** JSON for a `<script type="application/ld+json">`, with `<` escaped so the data can never close the script tag. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
