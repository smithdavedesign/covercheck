import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Load these with Node's resolver instead of re-bundling them: unpdf ships its own serverless
  // PDF.js bundle, PGlite loads WASM and data files from its package directory (local dev only),
  // and nodemailer is plain Node code.
  serverExternalPackages: ['unpdf', '@electric-sql/pglite', 'nodemailer'],
};

export default nextConfig;
