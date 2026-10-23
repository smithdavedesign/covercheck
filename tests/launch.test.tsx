import type { Metadata } from 'next';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CheckPage, { metadata as checkMetadata } from '../app/check/page';
import DashboardPage, { metadata as dashboardMetadata } from '../app/dashboard/page';
import RootLayout, { metadata as layoutMetadata } from '../app/layout';
import * as ogImage from '../app/opengraph-image';
import Home, { metadata as homeMetadata } from '../app/page';
import PrivacyPage, { metadata as privacyMetadata } from '../app/privacy/page';
import robots from '../app/robots';
import sitemap from '../app/sitemap';
import TermsPage, { metadata as termsMetadata } from '../app/terms/page';
import * as twitterImage from '../app/twitter-image';
import { PUBLIC_PATHS, jsonLdScript, softwareApplicationJsonLd } from '../lib/seo';
import { DEFAULT_SITE_URL, siteUrl } from '../lib/site';

afterEach(() => {
  vi.unstubAllEnvs();
});

const html = (element: React.ReactElement) => renderToString(element).replace(/<!-- -->/g, '');

/** Every page a visitor can open, with its metadata and a server render. */
const PAGES: { path: string; metadata: Metadata; render: () => Promise<string> }[] = [
  { path: '/', metadata: homeMetadata, render: async () => html(<Home />) },
  { path: '/check', metadata: checkMetadata, render: async () => html(await CheckPage({ searchParams: Promise.resolve({}) })) },
  { path: '/privacy', metadata: privacyMetadata, render: async () => html(<PrivacyPage />) },
  { path: '/terms', metadata: termsMetadata, render: async () => html(<TermsPage />) },
  { path: '/dashboard', metadata: dashboardMetadata, render: async () => html(<DashboardPage />) },
];
const INDEXED = PAGES.filter((page) => page.path !== '/dashboard');

describe('pages render', () => {
  it.each(PAGES.map((page) => [page.path, page] as const))('%s renders its heading', async (_path, page) => {
    const rendered = await page.render();
    expect(rendered).toMatch(/<h1[^>]*>[^<]+/);
  });
});

describe('search and sharing metadata', () => {
  it('every page has its own title and description', () => {
    const titles = PAGES.map((page) => page.metadata.title);
    const descriptions = PAGES.map((page) => page.metadata.description);
    for (const value of [...titles, ...descriptions]) expect(value).toEqual(expect.any(String));
    expect(new Set(titles).size).toBe(PAGES.length);
    expect(new Set(descriptions).size).toBe(PAGES.length);
    // Search results cut descriptions at about 160 characters.
    for (const description of descriptions as string[]) expect(description.length).toBeLessThanOrEqual(160);
  });

  it.each(PAGES.map((page) => [page.path, page] as const))('%s has a canonical URL, Open Graph and a large Twitter card', (path, { metadata }) => {
    expect(metadata.alternates?.canonical).toBe(path);
    const image = { width: 1200, height: 630, type: 'image/png', alt: expect.stringContaining('covercheck') };
    expect(metadata.openGraph).toMatchObject({
      type: 'website',
      siteName: 'covercheck',
      url: path,
      title: metadata.title,
      description: metadata.description,
      images: [{ url: '/opengraph-image', ...image }],
    });
    expect(metadata.twitter).toMatchObject({
      card: 'summary_large_image',
      title: metadata.title,
      description: metadata.description,
      images: [{ url: '/twitter-image', ...image }],
    });
  });

  it('only the private-link dashboard is kept out of search results', () => {
    expect(dashboardMetadata.robots).toEqual({ index: false, follow: false });
    for (const page of INDEXED) expect(page.metadata.robots).toBeUndefined();
  });

  it('resolves relative URLs against the production site', () => {
    expect(layoutMetadata.metadataBase?.toString()).toBe(`${siteUrl(process.env)}/`);
  });

  it('has a 1200×630 PNG share image for Open Graph and Twitter', () => {
    for (const image of [ogImage, twitterImage]) {
      expect(image.size).toEqual({ width: 1200, height: 630 });
      expect(image.contentType).toBe('image/png');
      expect(image.alt).toMatch(/covercheck/);
    }
  });

  it('draws the share image as a 1200×630 PNG', async () => {
    const response = ogImage.default();
    const png = new Uint8Array(await response.arrayBuffer());
    expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const header = new DataView(png.buffer, png.byteOffset + 16, 8);
    expect([header.getUint32(0), header.getUint32(4)]).toEqual([1200, 630]);
  });
});

describe('siteUrl', () => {
  it.each([
    [{ VERCEL_PROJECT_PRODUCTION_URL: 'covercheck.example.com' }, 'https://covercheck.example.com'],
    [{ VERCEL_PROJECT_PRODUCTION_URL: ' covercheck-abc.vercel.app ' }, 'https://covercheck-abc.vercel.app'],
    [{ VERCEL_PROJECT_PRODUCTION_URL: '' }, DEFAULT_SITE_URL],
    [{ VERCEL_PROJECT_PRODUCTION_URL: 'not a host' }, DEFAULT_SITE_URL],
    [{}, DEFAULT_SITE_URL],
  ])('%o → %s', (env, expected) => {
    expect(siteUrl(env)).toBe(expected);
  });
});

describe('JSON-LD', () => {
  function jsonLdIn(page: string) {
    const match = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page);
    expect(match).not.toBeNull();
    return JSON.parse(match![1]);
  }

  it('every page describes covercheck as a SoftwareApplication with a $15/month offer', () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'covercheck.example.com');
    const data = jsonLdIn(
      html(
        <RootLayout>
          <p>content</p>
        </RootLayout>,
      ),
    );
    expect(data).toMatchObject({
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'covercheck',
      url: 'https://covercheck.example.com/',
      operatingSystem: 'Web',
      offers: {
        '@type': 'Offer',
        price: '15.00',
        priceCurrency: 'USD',
        priceSpecification: { '@type': 'UnitPriceSpecification', price: '15.00', priceCurrency: 'USD', referenceQuantity: { value: 1, unitCode: 'MON' } },
      },
    });
  });

  it('can never close its script tag early', () => {
    const script = jsonLdScript({ name: '</script><script>alert(1)</script>' });
    expect(script).not.toContain('<');
    expect(JSON.parse(script)).toEqual({ name: '</script><script>alert(1)</script>' });
    expect(jsonLdScript(softwareApplicationJsonLd('https://covercheck.example.com'))).not.toContain('<');
  });
});

describe('robots.txt and sitemap.xml', () => {
  it('robots.txt allows indexing (not the API) and points at the sitemap', () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'covercheck.example.com');
    expect(robots()).toEqual({
      rules: { userAgent: '*', allow: '/', disallow: '/api/' },
      sitemap: 'https://covercheck.example.com/sitemap.xml',
    });
  });

  it('the sitemap lists exactly the public pages, as absolute URLs', () => {
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'covercheck.example.com');
    const urls = sitemap().map((entry) => entry.url);
    expect(urls).toEqual([
      'https://covercheck.example.com/',
      'https://covercheck.example.com/check',
      'https://covercheck.example.com/privacy',
      'https://covercheck.example.com/terms',
    ]);
    expect(PUBLIC_PATHS).toEqual(INDEXED.map((page) => page.path));
  });
});
