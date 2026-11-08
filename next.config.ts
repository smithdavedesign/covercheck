import type { NextConfig } from 'next';

/**
 * `npm run cf:build` sets this: the build becomes the Cloudflare Worker (OpenNext), and the Workers free plan caps a
 * Worker at 3 MiB compressed. Vercel builds never set it, so they're unchanged.
 */
const workerBuild = process.env.COVERCHECK_WORKER_BUILD === '1';

/** next/og's renderer: its JavaScript plus resvg.wasm, yoga.wasm and a font, ~0.7 MiB of a Worker once compressed. */
const OG_RENDERER = ['node_modules/next/dist/compiled/@vercel/og/**'];

const nextConfig: NextConfig = {
  // Load these with Node's resolver instead of re-bundling them: unpdf ships its own serverless
  // PDF.js bundle, PGlite loads WASM and data files from its package directory (local dev only),
  // and nodemailer is plain Node code.
  serverExternalPackages: ['unpdf', '@electric-sql/pglite', 'nodemailer'],
  // The share images are drawn once at build time and served as static files, so the Worker never runs their
  // renderer (pages only read the images' size and alt text). Left out of every route's trace, OpenNext leaves
  // its wasm and font out of the Worker.
  ...(workerBuild && { outputFileTracingExcludes: { '/**': OG_RENDERER } }),
};

export default nextConfig;
