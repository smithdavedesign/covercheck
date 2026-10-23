import type { MetadataRoute } from 'next';
import { PUBLIC_PATHS } from '../lib/seo';
import { siteUrl } from '../lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl(process.env);
  return PUBLIC_PATHS.map((path) => ({
    url: `${base}${path}`,
    changeFrequency: 'monthly',
    priority: path === '/' ? 1 : path === '/check' ? 0.8 : 0.3,
  }));
}
