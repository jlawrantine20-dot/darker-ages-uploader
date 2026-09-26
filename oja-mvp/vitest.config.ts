import { defineConfig } from 'vitest/config';

// Embedded Postgres (PGlite) takes a few seconds to boot on first use.
export default defineConfig({ test: { testTimeout: 30_000 } });
