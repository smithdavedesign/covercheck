import type { MetadataRoute } from 'next';
import { siteUrl } from '../lib/site';

/** Everything may be indexed except the JSON API; the dashboard keeps itself out with a noindex tag. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: '/api/' },
    sitemap: `${siteUrl(process.env)}/sitemap.xml`,
  };
}
