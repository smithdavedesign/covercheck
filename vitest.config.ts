import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // Several test files each boot an in-memory Postgres (PGlite, WASM) at once; on a busy machine that
    // CPU-bound start can pass vitest's 10 s hook default. Generous limits keep the suite from flaking.
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
