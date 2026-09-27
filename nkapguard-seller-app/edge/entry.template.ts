// NKAPGUARD Seller App: Supabase edge function entry. Deployed as the `seller-app` function.
// It loads the libraries, then imports the tested app bundle pinned to one git commit.
// Deno does not allow npm: imports inside remote modules, so they are passed in here.
import postgres from 'npm:postgres@3.4.9';
import * as hono from 'npm:hono@4.13.9';
import * as honoCors from 'npm:hono@4.13.9/cors';
import * as phone from 'npm:libphonenumber-js@1.13.14';
import * as nodeBuffer from 'node:buffer';
import * as nodeCrypto from 'node:crypto';

// The bundle reads a default import as the injected value itself, and named imports as its properties.
const esm = (ns: Record<string, unknown>) => ({ ...ns });
(globalThis as any).__nkg = {
  deps: {
    'npm:postgres@3.4.9': postgres,
    hono: esm(hono),
    'hono/cors': esm(honoCors),
    'libphonenumber-js': esm(phone),
    'node:buffer': esm(nodeBuffer),
    'node:crypto': esm(nodeCrypto),
  },
  defaults: { APP_URL: '__APP_URL__' },
};

await import('__BUNDLE_URL__');
